/** Native PostgreSQL transaction checks. Windows portable cluster, or isolated TEST_DATABASE_URL. */
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFile, writeFile, mkdir, unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { openDatabase } from '../dist/api/apps/api/src/database.js';
import { seedDatabase, hashDemoPassword } from '../dist/api/db/seed.js';
import { AuthService } from '../dist/api/apps/api/src/auth.js';
import { Marketplace } from '../dist/api/apps/api/src/marketplace.js';
import { DEMO_IDS } from '../dist/api/contracts/domain.js';

const execute = (file, args) => new Promise((resolveRun, reject) => {
  const child = spawn(file, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', data => { output += data; });
  child.stderr.on('data', data => { output += data; });
  child.on('error', reject);
  child.on('exit', code => code === 0 ? resolveRun(output) : reject(new Error(`${file} exited ${code}: ${output}`)));
});
let stop = async () => {}, db;
const results = [];
async function check(name, fn) { await fn(); results.push({ name, passed: true }); console.log(`PASS ${name}`); }
try {
  let connectionString = process.env.TEST_DATABASE_URL;
  if (!connectionString) {
    if (process.platform !== 'win32') throw new Error('Set TEST_DATABASE_URL to an empty isolated PostgreSQL database on this platform.');
    const binaries = await import('@embedded-postgres/windows-x64');
    const base = resolve('.data', `native-test-${randomUUID()}`);
    const dataDir = resolve(base, 'pgdata'), passwordFile = resolve(base, 'password');
    assert(base.startsWith(resolve('.data') + '\\'));
    await mkdir(base, { recursive: true });
    const password = randomBytes(24).toString('hex');
    await writeFile(passwordFile, password + '\n', { mode: 0o600 });
    try { await execute(binaries.initdb, ['-D', dataDir, '--username=postgres', '--auth=scram-sha-256', `--pwfile=${passwordFile}`, '--locale=C', '--encoding=UTF8']); }
    finally { await unlink(passwordFile); }
    const port = await new Promise((resolvePort, reject) => {
      const server = createServer(); server.on('error', reject);
      server.listen(0, '127.0.0.1', () => { const number = server.address().port; server.close(() => resolvePort(number)); });
    });
    await execute(binaries.pg_ctl, ['-D', dataDir, '-l', resolve(base, 'postgres.log'), '-o', `-h 127.0.0.1 -p ${port}`, '-w', 'start']);
    stop = async () => { await execute(binaries.pg_ctl, ['-D', dataDir, '-m', 'fast', '-w', 'stop']); };
    connectionString = `postgresql://postgres:${password}@127.0.0.1:${port}/postgres`;
  }
  db = await openDatabase({ connectionString, migrate: false, production: false });
  const version = (await db.query('SELECT version()')).rows[0].version;
  // Requires a deliberately empty test database. Never drop/replace existing application tables.
  assert.equal((await db.query("SELECT to_regclass('public.organizations') AS existing")).rows[0].existing, null, 'TEST_DATABASE_URL must be an empty isolated database');
  await db.transaction(async tx => tx.exec(await readFile('db/migrations/001_core.sql', 'utf8')));
  await db.transaction(async tx => tx.exec(await readFile('db/migrations/003_inventory_total_cap.sql', 'utf8')));
  await seedDatabase(db, { passwordHash: hashDemoPassword('NativeTestOnly2026!') });
  const auth = new AuthService(db, { secret: randomBytes(48).toString('hex'), production: false, uiOrigin: 'http://localhost:3000' });
  const service = new Marketplace(db, auth, true);
  const actor = { id: DEMO_IDS.buyerUser, organizationId: DEMO_IDS.buyerOrg, role: 'buyer', name: 'Test buyer', email: 'buyer@harvestlink.demo', sessionId: randomUUID() };
  const body = { items: [{ listingId: DEMO_IDS.tomatoListing, quantity: '50.000', expectedUnitPriceMinor: 8500 }], deliveryLocation: { label: 'Native test dock', latitude: 14.6, longitude: 121 }, deliveryBy: new Date(Date.now() + 4 * 3600000).toISOString(), notes: 'Native concurrency test' };
  await check('12 concurrent retries create one order and reserve once', async () => {
    const before = Number((await db.query('SELECT available_quantity FROM listings WHERE id=$1', [DEMO_IDS.tomatoListing])).rows[0].available_quantity);
    const orders = await Promise.all(Array.from({ length: 12 }, () => service.createOrder(actor, body, 'native-duplicate-intent')));
    assert.equal(new Set(orders.map(order => order.id)).size, 1);
    const after = Number((await db.query('SELECT available_quantity FROM listings WHERE id=$1', [DEMO_IDS.tomatoListing])).rows[0].available_quantity);
    assert.equal(before - after, 50);
  });
  await check('idempotency reuse with different content is rejected', async () => {
    await assert.rejects(service.createOrder(actor, { ...body, notes: 'Changed content' }, 'native-duplicate-intent'), error => error.code === 'IDEMPOTENCY_CONFLICT');
  });
  await check('competing transactions cannot oversell the final stock', async () => {
    await db.query('UPDATE listings SET available_quantity=75 WHERE id=$1', [DEMO_IDS.tomatoListing]);
    const attempts = await Promise.allSettled(Array.from({ length: 6 }, (_, i) => service.createOrder(actor, body, `native-stock-race-${i}`)));
    assert.equal(attempts.filter(result => result.status === 'fulfilled').length, 1);
    assert(attempts.filter(result => result.status === 'rejected').every(result => result.reason.code === 'INSUFFICIENT_STOCK'));
    assert.equal(Number((await db.query('SELECT available_quantity FROM listings WHERE id=$1', [DEMO_IDS.tomatoListing])).rows[0].available_quantity), 25);
  });
  await check('native deferred ledger constraint rejects unbalanced postings', async () => {
    const payment = (await db.query('SELECT id FROM payments LIMIT 1')).rows[0];
    await assert.rejects(db.transaction(tx => tx.query("INSERT INTO ledger_entries(id,transaction_id,payment_id,account,amount_minor,action) VALUES($1,$2,$3,'buyer_cash',-100,'hold')", [randomUUID(), randomUUID(), payment.id])), /not balanced/);
  });
  await check('native append-only audit rejects destructive changes', async () => {
    await assert.rejects(db.query('DELETE FROM audit_events'), /append-only/);
  });
  await mkdir('artifacts', { recursive: true });
  await writeFile('artifacts/native-postgres-report.json', JSON.stringify({ runtime: version, generatedAt: new Date().toISOString(), spatialExtensionTested: false, tests: results }, null, 2) + '\n');
  console.log(`${results.length} native PostgreSQL checks passed. PostGIS remains a separate deployment check.`);
} finally { await db?.close(); await stop(); }
