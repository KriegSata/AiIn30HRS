import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { openDatabase, migrateDatabase, type Database } from '../apps/api/src/database.js';
import { seedDatabase, hashDemoPassword } from './seed.js';
import { DEMO_IDS } from '../contracts/domain.js';

let database: Database;
before(async () => {
  database = await openDatabase({ dataDir: 'memory://', production: false });
  await seedDatabase(database, { passwordHash: hashDemoPassword('TestOnlyPassword2026!') });
});
after(async () => { await database?.close(); });

test('core migrations and relational demo seeds are repeatable', async () => {
  await migrateDatabase(database);
  assert.deepEqual(await seedDatabase(database, { passwordHash: 'ignored-on-existing-seed' }), { seeded: false });
  assert.equal(Number((await database.query<{ count: string }>('SELECT count(*) FROM listings')).rows[0]!.count), 6);
  assert.equal(Number((await database.query<{ count: string }>('SELECT count(*) FROM orders')).rows[0]!.count), 4);
  assert.equal(Number((await database.query<{ count: string }>('SELECT count(*) FROM schema_migrations')).rows[0]!.count), 2);
});

test('stock cannot become negative or exceed the supported bound', async () => {
  await assert.rejects(database.query('UPDATE listings SET available_quantity=-0.001 WHERE id=$1', [DEMO_IDS.tomatoListing]), /check constraint/);
  await assert.rejects(database.query('UPDATE listings SET available_quantity=1000001 WHERE id=$1', [DEMO_IDS.tomatoListing]), /check constraint/);
});

test('atomic inventory predicates prevent competing orders from overselling', async () => {
  const before = (await database.query<any>('SELECT available_quantity,reserved_quantity FROM listings WHERE id=$1', [DEMO_IDS.tomatoListing])).rows[0]!;
  const reserve = () => database.transaction(async tx => {
    const result = await tx.query('UPDATE listings SET available_quantity=available_quantity-500,reserved_quantity=reserved_quantity+500 WHERE id=$1 AND available_quantity>=500 RETURNING id', [DEMO_IDS.tomatoListing]);
    if (!result.rowCount) throw new Error('INSUFFICIENT_STOCK');
  });
  const result = await Promise.allSettled([reserve(), reserve()]);
  assert.equal(result.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(result.filter(r => r.status === 'rejected').length, 1);
  const final = (await database.query<any>('SELECT available_quantity,reserved_quantity FROM listings WHERE id=$1', [DEMO_IDS.tomatoListing])).rows[0]!;
  assert.equal(Number(final.available_quantity), Number(before.available_quantity) - 500);
  assert.equal(Number(final.reserved_quantity), Number(before.reserved_quantity) + 500);
  await database.query('UPDATE listings SET available_quantity=$2,reserved_quantity=$3 WHERE id=$1', [DEMO_IDS.tomatoListing, before.available_quantity, before.reserved_quantity]);
});

test('failed business transaction rolls inventory back', async () => {
  const before = (await database.query<any>('SELECT available_quantity FROM listings WHERE id=$1', [DEMO_IDS.riceListing])).rows[0]!.available_quantity;
  await assert.rejects(database.transaction(async tx => {
    await tx.query('UPDATE listings SET available_quantity=available_quantity-50 WHERE id=$1', [DEMO_IDS.riceListing]);
    throw new Error('PAYMENT_OR_ORDER_FAILED');
  }), /PAYMENT_OR_ORDER_FAILED/);
  assert.equal((await database.query<any>('SELECT available_quantity FROM listings WHERE id=$1', [DEMO_IDS.riceListing])).rows[0]!.available_quantity, before);
});

test('audit events, ledger entries and commercial snapshots are append-only', async () => {
  await assert.rejects(database.query("UPDATE audit_events SET reason='changed'"), /append-only/);
  await assert.rejects(database.query('DELETE FROM ledger_entries'), /append-only/);
  await assert.rejects(database.query("UPDATE order_items SET title='changed'"), /append-only/);
});

test('ledger enforces balance at transaction commit', async () => {
  await assert.rejects(database.transaction(async tx => {
    await tx.query("INSERT INTO ledger_entries(id,transaction_id,payment_id,account,amount_minor,action) VALUES($1,$2,$3,'buyer_cash',-100,'hold')", [randomUUID(), randomUUID(), '70000000-0000-4000-8000-000000000001']);
  }), /not balanced/);
  const rows = await database.query<any>('SELECT transaction_id FROM ledger_entries GROUP BY transaction_id HAVING sum(amount_minor)<>0');
  assert.equal(rows.rowCount, 0);
});

test('idempotency uniqueness is durable and organization scoped', async () => {
  const key = randomUUID();
  await database.query("INSERT INTO idempotency_keys(organization_id,scope,key,request_hash,response_status,response_body) VALUES($1,'POST /orders',$2,'fingerprint',201,'{\"id\":\"saved-order\"}')", [DEMO_IDS.buyerOrg, key]);
  await assert.rejects(database.query("INSERT INTO idempotency_keys(organization_id,scope,key,request_hash) VALUES($1,'POST /orders',$2,'different')", [DEMO_IDS.buyerOrg, key]), /duplicate key/);
  await database.query("INSERT INTO idempotency_keys(organization_id,scope,key,request_hash) VALUES($1,'POST /orders',$2,'other-org')", [DEMO_IDS.supplierOrg, key]);
  const result = await database.query<any>('SELECT response_body FROM idempotency_keys WHERE organization_id=$1 AND key=$2', [DEMO_IDS.buyerOrg, key]);
  assert.deepEqual(result.rows[0]!.response_body, { id: 'saved-order' });
});

test('lot dates and geographical coordinate bounds are enforced', async () => {
  await assert.rejects(database.query('UPDATE lots SET expires_at=harvested_at'), /check constraint/);
  await assert.rejects(database.query('UPDATE organizations SET latitude=91 WHERE id=$1', [DEMO_IDS.supplierOrg]), /check constraint/);
});

test('delivered goods retain source-lot lineage and frozen origin', async () => {
  const result = await database.query<any>("SELECT oi.lot_snapshot, l.code FROM order_items oi JOIN lots l ON l.id=oi.lot_id JOIN orders o ON o.id=oi.order_id WHERE o.status='completed'");
  assert.equal(result.rowCount, 1);
  assert.equal(result.rows[0]!.lot_snapshot.code, result.rows[0]!.code);
  assert.equal(typeof result.rows[0]!.lot_snapshot.origin.latitude, 'number');
});

test('production cannot silently fall back to PGlite', async () => {
  await assert.rejects(openDatabase({ connectionString: '', production: true, dataDir: 'memory://' }), /requires DATABASE_URL/);
});

test('file-backed database survives close and reopen', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'harvestlink-db-test-'));
  let persistent: Database | undefined;
  try {
    persistent = await openDatabase({ dataDir: dir, production: false });
    await persistent.query('CREATE TABLE persistence_probe(value TEXT NOT NULL)');
    await persistent.query('INSERT INTO persistence_probe(value) VALUES($1)', ['durable']);
    await persistent.close();
    persistent = await openDatabase({ dataDir: dir, production: false });
    assert.equal((await persistent.query<any>('SELECT value FROM persistence_probe')).rows[0]!.value, 'durable');
  } finally {
    await persistent?.close();
    if (!resolve(dir).startsWith(resolve(tmpdir())) || !dir.includes('harvestlink-db-test-')) throw new Error('Unsafe temporary cleanup path');
    await rm(dir, { recursive: true, force: true });
  }
});
