import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { openDatabase, type Database, type Queryable } from '../src/database.js';
import { createServer } from '../src/server.js';
import { hashPassword } from '../src/core.js';
import { seedDatabase } from '../../../db/seed.js';
import { DEMO_IDS as ids } from '../../../contracts/domain.js';

let db: Database, server: Awaited<ReturnType<typeof createServer>>;
const tokens: Record<string, string> = {};
const password = 'DiscoveryTestsOnly2026!';
const privateIds: Record<string, string> = {};
const at = (hours: number) => new Date(Date.now() + hours * 3600000).toISOString();
const location = { label: 'Synthetic test location', latitude: 0, longitude: 0 };
async function insert(tx: Queryable, table: string, fields: Record<string, unknown>) {
  const keys = Object.keys(fields);
  await tx.query(`INSERT INTO ${table}(${keys.join(',')}) VALUES(${keys.map((_, i) => '$' + (i + 1)).join(',')})`, Object.values(fields));
}

async function purchase(listingId: string, status = 'completed', paymentStatus = 'released', recordedPaymentStatus = paymentStatus, paymentExists = true) {
  const row = (await db.query('SELECT l.*,t.code FROM listings l JOIN lots t ON t.id=l.lot_id WHERE l.id=$1', [listingId])).rows[0] as any;
  const orderId = randomUUID(), total = 25 * Number(row.price_per_unit_minor);
  await db.transaction(async tx => {
    await insert(tx, 'orders', { id: orderId, order_number: 'DISCOVERY-' + orderId, buyer_org_id: ids.buyerOrg, supplier_org_id: row.supplier_org_id, status, payment_status: paymentStatus, subtotal_minor: total, total_minor: total, delivery_location: JSON.stringify(location), delivery_by: at(24) });
    await insert(tx, 'order_items', { id: randomUUID(), order_id: orderId, listing_id: listingId, lot_id: row.lot_id, lot_code: row.code, title: row.title, quantity: '25.000', unit: row.unit, price_per_unit_minor: row.price_per_unit_minor, line_total_minor: total, lot_snapshot: JSON.stringify({ source: 'isolated discovery fixture' }) });
    if (paymentExists) await insert(tx, 'payments', { id: randomUUID(), order_id: orderId, invoice_number: 'DISCOVERY-INVOICE-' + orderId, amount_minor: total, status: recordedPaymentStatus });
  });
}

async function hiddenListing(name: string, options: { status?: string; expired?: boolean; chain?: string; organization?: string } = {}) {
  const id = randomUUID(), lotId = randomUUID(), organization = options.organization ?? ids.supplierOrg;
  await db.transaction(async tx => {
    await insert(tx, 'lots', { id: lotId, supplier_org_id: organization, code: 'DISCOVERY-' + id, harvested_at: at(-48), expires_at: at(options.expired ? -1 : 48), origin_label: location.label, origin_latitude: 0, origin_longitude: 0, catch_method: 'not_applicable', cold_chain_status: options.chain ?? 'ambient', source_type: 'farm', source_name: 'Synthetic farm' });
    await insert(tx, 'listings', { id, supplier_org_id: organization, lot_id: lotId, title: name, description: 'Isolated discovery eligibility fixture', category: 'produce', unit: 'kg', price_per_unit_minor: 1000, available_quantity: '100.000', min_order_quantity: '25.000', location_label: location.label, latitude: 0, longitude: 0, status: options.status ?? 'active' });
  });
  privateIds[name] = id;
  // Make each hidden row outrank public rows if the visibility predicates are lost.
  for (let i = 0; i < 3; i++) await purchase(id);
}

async function get(query: string, who = 'buyer') {
  const response = await fetch(server.url + '/api/v1/listings' + (query ? '?' + query : ''), { headers: { Authorization: `Bearer ${tokens[who]}` } });
  return { status: response.status, body: await response.json() as any };
}
async function ranked(query: string, who = 'buyer') { const result = await get(query, who); assert.equal(result.status, 200, JSON.stringify(result.body)); return result.body; }

before(async () => {
  db = await openDatabase({ dataDir: 'memory://', migrate: true });
  await seedDatabase(db, { passwordHash: await hashPassword(password) });
  // Public tomato and rice round to the same position. Tomato's private precision is
  // farther from (0,0), so ranking it first proves private precision is not used.
  for (const [id, latitude, longitude, harvest] of [
    [ids.tomatoListing, 0.049, 0.049, -24], [ids.riceListing, 0.001, 0.001, -72],
    [ids.lettuceListing, 0, 2, -48], [ids.mangoListing, 20, 0, -24],
    [ids.tunaListing, 0, -179.9, -48], [ids.shrimpListing, 0, 170, -48],
  ] as const) {
    await db.query('UPDATE listings SET latitude=$2,longitude=$3 WHERE id=$1', [id, latitude, longitude]);
    // Equal timestamps are set below; wall-clock drift must not accidentally decide ties.
    await db.query('UPDATE lots SET harvested_at=$2,expires_at=$3 WHERE id=(SELECT lot_id FROM listings WHERE id=$1)', [id, at(harvest), at(96)]);
  }
  const tiedHarvest = at(-48);
  for (const id of [ids.tunaListing, ids.lettuceListing, ids.shrimpListing]) await db.query('UPDATE lots SET harvested_at=$2 WHERE id=(SELECT lot_id FROM listings WHERE id=$1)', [id, tiedHarvest]);
  await purchase(ids.tomatoListing); await purchase(ids.tomatoListing); await purchase(ids.mangoListing);
  // Rice already has one completed/released seed order of 500 kg. Tomato's two
  // 25 kg orders rank ahead: count distinct orders, not quantity or monetary value.
  for (const [status, paymentStatus, recordedStatus, paymentExists] of [
    ['completed', 'unpaid', 'unpaid', true], ['completed', 'refunded', 'refunded', true],
    ['cancelled', 'released', 'released', true], ['pending_confirmation', 'released', 'released', true],
    ['delivered', 'released', 'released', true], ['completed', 'released', 'refunded', true],
    ['completed', 'refunded', 'released', true], ['completed', 'released', 'released', false],
  ] as const) await purchase(ids.mangoListing, status, paymentStatus, recordedStatus, paymentExists);
  await hiddenListing('Private draft', { status: 'draft' });
  await hiddenListing('Paused stock', { status: 'paused' });
  await hiddenListing('Recalled stock', { status: 'recalled' });
  await hiddenListing('Expired stock', { expired: true });
  await hiddenListing('Unknown cold chain', { chain: 'unknown' });
  await hiddenListing('Excursion stock', { chain: 'excursion' });
  await hiddenListing('Unverified supplier', { organization: '10000000-0000-4000-8000-000000000006' });
  server = await createServer(db, { secret: 'test-discovery-signing-secret-not-for-production', uiOrigin: 'http://localhost:3000', production: false, sandbox: true, port: 0, jobs: false });
  for (const who of ['buyer', 'supplier', 'fisher', 'admin']) {
    const response = await fetch(server.url + '/api/v1/auth/login', { method: 'POST', headers: { Origin: 'http://localhost:3000', 'Content-Type': 'application/json' }, body: JSON.stringify({ email: `${who}@harvestlink.demo`, password }) });
    const result = await response.json() as any; assert.equal(response.status, 200, JSON.stringify(result)); tokens[who] = result.data.accessToken;
  }
});
after(async () => { if (server) await server.close(); if (db) await db.close(); });

test('popular counts distinct completed, released-payment orders and ranks before pagination', async () => {
  const all = await ranked('sort=popular&pageSize=100');
  assert.deepEqual(all.data.map((l: any) => l.id), [ids.tomatoListing, ids.mangoListing, ids.riceListing, ids.tunaListing, ids.lettuceListing, ids.shrimpListing]);
  assert.equal(all.meta.total, 6);
  const pages = await Promise.all([1, 2, 3].map(page => ranked(`sort=popular&pageSize=2&page=${page}`)));
  assert.deepEqual(pages.flatMap(p => p.data.map((l: any) => l.id)), all.data.map((l: any) => l.id));
  assert.ok(pages.every(p => p.meta.total === 6));
  assert.ok(all.data.every((l: any) => !('popularity' in l) && !('completed_orders' in l)), 'internal ranking statistics must not appear in the DTO');
  assert.deepEqual((await ranked('sort=popular&pageSize=2&page=4')).data, []);
});

test('nearest uses public rounded coordinates, popularity ties, and global ranking before pages', async () => {
  const all = await ranked('sort=nearest&latitude=0&longitude=0&pageSize=100');
  assert.deepEqual(all.data.map((l: any) => l.id), [ids.tomatoListing, ids.riceListing, ids.lettuceListing, ids.mangoListing, ids.shrimpListing, ids.tunaListing]);
  assert.equal(all.data[0].location.latitude, 0); assert.equal(all.data[0].location.longitude, 0);
  assert.equal(all.data[1].location.latitude, 0); assert.equal(all.data[1].location.longitude, 0);
  const first = await ranked('sort=nearest&latitude=0&longitude=0&pageSize=2');
  const second = await ranked('sort=nearest&latitude=0&longitude=0&pageSize=2&page=2');
  assert.deepEqual([...first.data, ...second.data].map((l: any) => l.id), all.data.slice(0, 4).map((l: any) => l.id));
  assert.equal(first.meta.total, 6); assert.equal(second.meta.total, 6);
});

test('nearest handles the antimeridian, equator, poles, and inclusive coordinate bounds', async () => {
  for (const longitude of [-180, 180]) {
    const result = await ranked(`sort=nearest&latitude=0&longitude=${longitude}&pageSize=2`);
    assert.deepEqual(result.data.map((l: any) => l.id), [ids.tunaListing, ids.shrimpListing]);
  }
  const north = await ranked('sort=nearest&latitude=90&longitude=0');
  assert.deepEqual(north.data.map((l: any) => l.id), [ids.mangoListing, ids.tomatoListing, ids.riceListing, ids.tunaListing, ids.lettuceListing, ids.shrimpListing]);
  const south = await ranked('sort=nearest&latitude=-90&longitude=0');
  assert.deepEqual(south.data.map((l: any) => l.id), [ids.tomatoListing, ids.riceListing, ids.tunaListing, ids.lettuceListing, ids.shrimpListing, ids.mangoListing]);
});

test('coordinate validation rejects missing, unpaired, nonfinite, out-of-range and non-nearest values', async () => {
  for (const query of [
    'sort=nearest', 'sort=nearest&latitude=0', 'sort=nearest&longitude=0',
    'sort=nearest&latitude=91&longitude=0', 'sort=nearest&latitude=-90.1&longitude=0',
    'sort=nearest&latitude=0&longitude=180.1', 'sort=nearest&latitude=0&longitude=-181',
    'sort=nearest&latitude=NaN&longitude=0', 'sort=nearest&latitude=0&longitude=Infinity',
    'sort=nearest&latitude=&longitude=0', 'sort=nearest&latitude=%20&longitude=0',
    'sort=nearest&latitude=0&longitude=false', 'sort=nearest&latitude=0&latitude=1&longitude=0',
    'latitude=0&longitude=0', 'sort=popular&latitude=0&longitude=0',
    'sort=newest&latitude=0', 'sort=price_asc&latitude=0&longitude=0',
  ]) {
    const result = await get(query); assert.equal(result.status, 400, query); assert.ok(result.body.error.code); assert.ok(result.body.error.requestId);
  }
});

test('discovery preserves eligibility, ownership, admin scope and existing search/category/status filters', async () => {
  for (const query of ['sort=popular', 'sort=nearest&latitude=0&longitude=0']) {
    const visible = await ranked(query + '&pageSize=100');
    assert.ok(visible.data.every((l: any) => !Object.values(privateIds).includes(l.id)));
    const own = await ranked(query + '&mine=true&pageSize=100', 'supplier');
    assert.ok(own.data.every((l: any) => l.supplierOrgId === ids.supplierOrg));
    assert.ok(own.data.some((l: any) => l.id === privateIds['Private draft']));
    assert.equal((await get(query + '&scope=all', 'buyer')).status, 403);
    const admin = await ranked(query + '&scope=all&pageSize=100', 'admin'); assert.equal(admin.meta.total, 13);
    const seafood = await ranked(query + '&category=seafood'); assert.deepEqual(new Set(seafood.data.map((l: any) => l.id)), new Set([ids.tunaListing, ids.shrimpListing]));
    const search = await ranked(query + '&search=tomatoes'); assert.equal(search.data.length, 1); assert.equal(search.data[0].id, ids.tomatoListing);
    const drafts = await ranked(query + '&mine=true&status=draft', 'supplier'); assert.deepEqual(drafts.data.map((l: any) => l.id), [privateIds['Private draft']]);
  }
  const prices = (await ranked('sort=price_asc')).data.map((l: any) => l.pricePerUnitMinor); assert.deepEqual(prices, [...prices].sort((a, b) => a - b));
  const harvests = (await ranked('sort=freshness')).data.map((l: any) => Date.parse(l.lot.harvestedAt)); assert.deepEqual(harvests, [...harvests].sort((a, b) => b - a));
  const created = (await ranked('sort=newest')).data.map((l: any) => Date.parse(l.createdAt)); assert.deepEqual(created, [...created].sort((a, b) => b - a));
});

test('location discovery is read-only and does not persist request coordinates in profile, audit or outbox', async () => {
  const before = (await db.query('SELECT (SELECT count(*) FROM audit_events) audits,(SELECT count(*) FROM outbox_events) events,(SELECT latitude FROM organizations WHERE id=$1) latitude,(SELECT longitude FROM organizations WHERE id=$1) longitude', [ids.buyerOrg])).rows[0];
  await ranked('sort=nearest&latitude=12.34567&longitude=-45.67891');
  const after = (await db.query('SELECT (SELECT count(*) FROM audit_events) audits,(SELECT count(*) FROM outbox_events) events,(SELECT latitude FROM organizations WHERE id=$1) latitude,(SELECT longitude FROM organizations WHERE id=$1) longitude', [ids.buyerOrg])).rows[0];
  assert.deepEqual(after, before);
});
