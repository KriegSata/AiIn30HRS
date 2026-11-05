import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { io } from 'socket.io-client';
import { openDatabase, type Database } from '../src/database.js';
import { createServer } from '../src/server.js';
import { seedDatabase } from '../../../db/seed.js';
import { DEMO_IDS as ids } from '../../../contracts/domain.js';
import { hashPassword, checkPassword, units, money, stable, validate, spec } from '../src/core.js';

let db: Database, server: Awaited<ReturnType<typeof createServer>>;
const password = 'TestOnlyHarvest2026!', secret = 'test-only-signing-secret-no-production-use-2026';
const origin = 'http://localhost:3000';
const sessions: Record<string, any> = {}, cookies: Record<string, string> = {};
const loc = { label: 'Quezon City', latitude: 14.65, longitude: 121.05 };
const date = (hours: number) => new Date(Date.now() + hours * 3600000).toISOString();
const ajv = new Ajv({ strict: false, allErrors: true }); addFormats(ajv); ajv.addSchema({ $id: 'contract', components: spec.components });
const responseValidators = new Map<string, any>();
function responseCheck(method: string, path: string, status: number, body: any) {
  const matched = Object.entries(spec.paths).find(([p]) => new RegExp('^' + p.replace(/\{\w+\}/g, '[^/]+') + '$').test(path.split('?')[0]));
  if (!matched || status === 204) return;
  const operation = (matched[1] as any)[method.toLowerCase()], schema = operation?.responses?.[status]?.content?.['application/json']?.schema;
  if (!schema) return;
  const key = method + matched[0] + status;
  let v = responseValidators.get(key);
  if (!v) { const adjusted = JSON.parse(JSON.stringify(schema).replace(/#\/components/g, 'contract#/components')); v = ajv.compile(adjusted); responseValidators.set(key, v); }
  assert.ok(v(body), `${method} ${path} response violates contract: ${JSON.stringify(v.errors)}`);
}
async function request(method: string, path: string, who?: string, body?: any, headers: Record<string, string> = {}) {
  const res = await fetch(server.url + '/api/v1' + path, { method, headers: { Origin: origin, ...(who ? { Authorization: `Bearer ${sessions[who].accessToken}` } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  const raw = await res.text(), data = raw ? JSON.parse(raw) : null;
  responseCheck(method, path, res.status, data);
  return { status: res.status, body: data, data: data?.data, cookie: res.headers.get('set-cookie'), headers: res.headers };
}
async function ok(method: string, path: string, who?: string, body?: any, headers?: Record<string, string>) { const r = await request(method, path, who, body, headers); assert.ok(r.status >= 200 && r.status < 300, `${method} ${path}: ${r.status} ${JSON.stringify(r.body)}`); return r.data; }
async function newOrder(listingId = ids.tomatoListing, quantity = '25.000') { const listing = await ok('GET', `/listings/${listingId}`, 'buyer'); return ok('POST', '/orders', 'buyer', { items: [{ listingId, quantity, expectedUnitPriceMinor: listing.pricePerUnitMinor }], deliveryLocation: loc, deliveryBy: date(24), notes: 'Integration test order' }, { 'Idempotency-Key': randomUUID() }); }
async function transition(order: any, status: string, who = 'supplier', reason?: string) { const current = await ok('GET', `/orders/${order.id}`, who); return ok('POST', `/orders/${order.id}/status`, who, { expectedVersion: current.version, status, ...(reason ? { reason } : {}) }); }
async function pay(order: any, action: string, who = 'buyer', reason?: string) { return ok('POST', `/orders/${order.id}/payment`, who, { action, ...(reason ? { reason } : {}) }, { 'Idempotency-Key': randomUUID() }); }

before(async () => {
  db = await openDatabase({ dataDir: 'memory://', migrate: true });
  await seedDatabase(db, { passwordHash: await hashPassword(password) });
  server = await createServer(db, { secret, uiOrigin: origin, production: false, sandbox: true, port: 0, jobs: false });
  for (const who of ['buyer', 'supplier', 'fisher', 'logistics', 'admin']) { const r = await request('POST', '/auth/login', undefined, { email: `${who}@harvestlink.demo`, password }); assert.equal(r.status, 200, JSON.stringify(r.body)); sessions[who] = r.data; cookies[who] = r.cookie!.split(';')[0]; }
});
after(async () => { if (server) await server.close(); if (db) await db.close(); });

test('password hashing, decimal precision, half-up rounding, strict validation and canonical fingerprints', async () => {
  const hash = await hashPassword(password); assert.ok(await checkPassword(password, hash)); assert.equal(await checkPassword('wrong', hash), false); assert.equal(await checkPassword(password, 'invalid'), false);
  assert.equal(units('1.005'), 1005n); assert.equal(units('-1.005', true), -1005n); assert.equal(money('1.005', 100), 101);
  for (const input of ['0', '1.2345', '1e2', '1000000.001', '-1']) assert.throws(() => units(input));
  assert.equal(stable({ b: 2, a: [{ x: 1 }] }), stable({ a: [{ x: 1 }], b: 2 }));
  assert.throws(() => validate('RegisterRequest', { role: 'admin' }));
});

test('authentication rejects tampered/wrong audience JWT and exposes safe health and headers', async () => {
  assert.equal((await request('GET', '/orders')).status, 401);
  assert.equal((await request('GET', '/orders', undefined, undefined, { Authorization: 'Bearer ' + jwt.sign({ sub: ids.buyerUser, sid: randomUUID() }, secret, { audience: 'wrong', issuer: 'harvestlink' }) })).status, 401);
  assert.equal((await request('GET', '/orders', undefined, undefined, { Authorization: 'Bearer broken' })).status, 401);
  const health = await request('GET', '/health'); assert.equal(health.data.checks.database, true); assert.equal(health.headers.get('x-content-type-options'), 'nosniff'); assert.equal(health.headers.get('cache-control'), 'no-store');
  const me = await ok('GET', '/auth/me', 'buyer'); assert.equal(me.user.organizationId, ids.buyerOrg);
  assert.equal((await request('POST', '/auth/login', undefined, { email: 'missing@example.com', password })).status, 401);
  assert.equal((await request('POST', '/auth/login', undefined, { email: 'buyer@harvestlink.demo', password: 'incorrect-password' })).status, 401);
  assert.equal((await request('POST', '/auth/login', undefined, { email: 'buyer@harvestlink.demo', password }, { Origin: 'https://evil.example' })).status, 403);
});

test('refresh rotates digests and replay revokes entire family, logout and cookie origin checks', async () => {
  const login = await request('POST', '/auth/login', undefined, { email: 'buyer@harvestlink.demo', password });
  assert.match(login.cookie!, /HttpOnly/i); assert.match(login.cookie!, /SameSite=Lax/i);
  const oldCookie = login.cookie!.split(';')[0];
  const renewed = await request('POST', '/auth/refresh', undefined, undefined, { Cookie: oldCookie }); assert.equal(renewed.status, 200);
  assert.equal((await request('POST', '/auth/refresh', undefined, undefined, { Cookie: oldCookie })).status, 401);
  assert.equal((await request('GET', '/auth/me', undefined, undefined, { Authorization: 'Bearer ' + renewed.data.accessToken })).status, 401);
  assert.equal((await request('POST', '/auth/refresh', undefined, undefined, { Origin: 'https://evil.example' })).status, 403);
  assert.equal((await request('POST', '/auth/refresh')).status, 401);
  await ok('POST', '/auth/logout', undefined, undefined, { Cookie: oldCookie }); await ok('POST', '/auth/logout');
  const stored = (await db.query('SELECT refresh_token_hash FROM refresh_sessions LIMIT 1')).rows[0] as any; assert.match(stored.refresh_token_hash, /^[a-f0-9]{64}$/);
});

test('registration, profile optimistic version, verification and session suspension enforce authority', async () => {
  const body = { email: 'new-supplier@example.test', password, name: 'Rosa Farmer', organizationName: 'Rosa Farm', role: 'supplier', phone: '+639001112222', location: loc, licenseNumber: 'TEST-0001' };
  const registered = await request('POST', '/auth/register', undefined, body); assert.equal(registered.status, 201); sessions.newSupplier = registered.data;
  assert.equal(registered.data.organization.verificationStatus, 'pending');
  assert.equal((await request('POST', '/auth/register', undefined, body)).status, 409);
  assert.equal((await request('POST', '/auth/register', undefined, { ...body, email: 'admin-attack@example.test', role: 'admin' })).status, 400);
  const profile = await ok('GET', '/organizations/me', 'newSupplier');
  const edited = await ok('PATCH', '/organizations/me', 'newSupplier', { expectedVersion: profile.version, description: 'Fresh family produce', contactName: 'Rosa', phone: '+639004445555', location: loc, certificates: [] });
  assert.equal(edited.description, 'Fresh family produce');
  assert.equal((await request('PATCH', '/organizations/me', 'newSupplier', { expectedVersion: profile.version, name: 'stale' })).status, 409);
  assert.equal((await request('PATCH', '/organizations/me', 'newSupplier', { expectedVersion: edited.version, role: 'admin' })).status, 400);
  const verified = await ok('POST', `/organizations/${edited.id}/verification`, 'admin', { expectedVersion: edited.version, status: 'verified', reason: 'Test evidence reviewed' }); assert.equal(verified.verificationStatus, 'verified');
  const pending = await ok('PATCH', '/organizations/me', 'newSupplier', { expectedVersion: verified.version, licenseNumber: 'REVISED' }); assert.equal(pending.verificationStatus, 'pending');
  await ok('POST', `/organizations/${edited.id}/verification`, 'admin', { expectedVersion: pending.version, status: 'suspended', reason: 'Test suspension' });
  assert.equal((await request('GET', '/auth/me', 'newSupplier')).status, 401);
  assert.equal((await request('POST', `/organizations/${ids.adminOrg}/verification`, 'admin', { expectedVersion: 1, status: 'verified', reason: 'self approval' })).status, 403);
});

test('directories, listings, search and private projections follow role and organization boundaries', async () => {
  assert.equal((await request('GET', '/organizations', 'buyer')).status, 403);
  assert.ok((await ok('GET', '/organizations', 'admin')).length >= 6);
  const partners = await ok('GET', '/organizations/partners?role=logistics', 'supplier'); assert.equal(partners.length, 1); assert.equal(partners[0].email, undefined);
  const catalog = await ok('GET', '/listings?category=produce&search=tomato', 'buyer'); assert.equal(catalog.length, 1); assert.equal(catalog[0].location.latitude, 16.5);
  const mine = await ok('GET', '/listings?mine=true', 'supplier'); assert.equal(mine.length, 4); assert.equal(mine[0].supplierOrgId, ids.supplierOrg);
  assert.equal((await request('GET', '/listings?scope=all', 'buyer')).status, 403);
  assert.equal((await request('GET', '/listings?bad=1', 'buyer')).status, 400);
  assert.equal((await request('GET', '/listings?pageSize=1001', 'buyer')).status, 400);
  assert.equal((await request('GET', '/listings/not-a-uuid', 'buyer')).status, 400);
  const listing = await ok('GET', `/listings/${ids.tomatoListing}`, 'buyer'); assert.equal(listing.lot.origin.latitude, 16.5);
  assert.equal((await request('PATCH', `/listings/${ids.tomatoListing}`, 'fisher', { expectedVersion: listing.version, title: 'Steal' })).status, 404);
  assert.equal((await request('GET', '/orders', 'logistics')).status, 403);
  assert.equal((await request('GET', '/orders/50000000-0000-4000-8000-000000000002', 'fisher')).status, 404);
  assert.equal((await request('GET', '/orders/50000000-0000-4000-8000-000000000001/payment', 'logistics')).status, 403);
});

test('supplier creates traceable lots, validates perishability and audits stock corrections and recall', async () => {
  const body: any = { title: 'Test cucumbers', description: 'Fresh traceable lot', category: 'produce', unit: 'kg', pricePerUnitMinor: 5500, currency: 'PHP', quantity: '100.000', minOrderQuantity: '10.000', location: loc, status: 'active', lot: { code: 'TEST-' + randomUUID(), harvestedAt: date(-1), expiresAt: date(72), origin: loc, catchMethod: 'not_applicable', coldChainStatus: 'ambient', storageMinC: 10, storageMaxC: 20, sourceType: 'farm', sourceName: 'Farm field 1' } };
  assert.equal((await request('POST', '/listings', 'buyer', body)).status, 403);
  assert.equal((await request('POST', '/listings', 'supplier', { ...body, category: 'seafood' })).status, 422);
  assert.equal((await request('POST', '/listings', 'supplier', { ...body, lot: { ...body.lot, harvestedAt: date(1) } })).status, 422);
  assert.equal((await request('POST', '/listings', 'supplier', { ...body, quantity: '0' })).status, 422);
  let listing = await ok('POST', '/listings', 'supplier', body); assert.equal(listing.lot.evidenceType, 'supplier_declared');
  assert.equal((await request('PATCH', `/listings/${listing.id}`, 'supplier', { expectedVersion: listing.version, quantityDelta: '-200', reason: 'Bad correction' })).status, 409);
  assert.equal((await request('PATCH', `/listings/${listing.id}`, 'supplier', { expectedVersion: listing.version, quantityDelta: '-10' })).status, 422);
  listing = await ok('PATCH', `/listings/${listing.id}`, 'supplier', { expectedVersion: listing.version, quantityDelta: '-10', reason: 'Damaged stock removed', pricePerUnitMinor: 5700, minOrderQuantity: '5.000', title: 'Fresh cucumbers', description: 'Updated listing' }); assert.equal(listing.availableQuantity, '90.000');
  listing = await ok('PATCH', `/listings/${listing.id}`, 'supplier', { expectedVersion: listing.version, status: 'paused' });
  assert.equal((await request('GET', `/listings/${listing.id}`, 'buyer')).status, 404);
  listing = await ok('PATCH', `/listings/${listing.id}`, 'supplier', { expectedVersion: listing.version, status: 'active' });
  listing = await ok('PATCH', `/listings/${listing.id}`, 'admin', { expectedVersion: listing.version, status: 'recalled', reason: 'Traceability test recall' });
  assert.equal((await request('PATCH', `/listings/${listing.id}`, 'supplier', { expectedVersion: listing.version, status: 'active' })).status, 409);
});

test('idempotent order submission survives duplicate retries and changed-payload conflicts without stock duplication', async () => {
  const key = randomUUID(), body = { items: [{ listingId: ids.tomatoListing, quantity: '25.000', expectedUnitPriceMinor: 8500 }], deliveryLocation: loc, deliveryBy: date(24), notes: 'Retry intent' };
  const stockBefore = await ok('GET', `/listings/${ids.tomatoListing}`, 'supplier');
  const [a, b] = await Promise.all([request('POST', '/orders', 'buyer', body, { 'Idempotency-Key': key }), request('POST', '/orders', 'buyer', body, { 'Idempotency-Key': key })]);
  assert.equal(a.status, 201, JSON.stringify(a.body)); assert.equal(b.status, 201); assert.equal(a.data.id, b.data.id); assert.equal(a.data.items[0].lotSnapshot.code, stockBefore.lot.code);
  assert.equal((await request('POST', '/orders', 'buyer', { ...body, notes: 'Changed' }, { 'Idempotency-Key': key })).status, 409);
  assert.equal((await request('POST', '/orders', 'buyer', body)).status, 400);
  const stockAfter = await ok('GET', `/listings/${ids.tomatoListing}`, 'supplier'); assert.equal(Number(stockBefore.availableQuantity) - Number(stockAfter.availableQuantity), 25);
  await transition(a.data, 'cancelled', 'buyer');
  const restored = await ok('GET', `/listings/${ids.tomatoListing}`, 'supplier'); assert.equal(restored.availableQuantity, stockBefore.availableQuantity);
  const duplicate = await ok('POST', '/orders', 'buyer', body, { 'Idempotency-Key': key }); assert.equal(duplicate.id, a.data.id);
});

test('concurrent oversized buyers cannot oversell and failed multi-line order rolls back every reservation', async () => {
  const body = { items: [{ listingId: ids.mangoListing, quantity: '500.000', expectedUnitPriceMinor: 12000 }], deliveryLocation: loc, deliveryBy: date(24), notes: 'Parallel stock race' };
  const responses = await Promise.all([request('POST', '/orders', 'buyer', body, { 'Idempotency-Key': randomUUID() }), request('POST', '/orders', 'buyer', body, { 'Idempotency-Key': randomUUID() })]);
  assert.deepEqual(responses.map(r => r.status).sort(), [201, 409]);
  await transition(responses.find(r => r.status === 201)!.data, 'cancelled', 'buyer');
  const before = await ok('GET', `/listings/${ids.tomatoListing}`, 'supplier');
  assert.equal((await request('POST', '/orders', 'buyer', { ...body, items: [{ listingId: ids.tomatoListing, quantity: '25.000', expectedUnitPriceMinor: 8500 }, { listingId: ids.tunaListing, quantity: '25.000', expectedUnitPriceMinor: 32000 }] }, { 'Idempotency-Key': randomUUID() })).status, 422);
  const after = await ok('GET', `/listings/${ids.tomatoListing}`, 'supplier'); assert.equal(after.availableQuantity, before.availableQuantity);
  assert.equal((await request('POST', '/orders', 'buyer', { ...body, items: [{ listingId: ids.tomatoListing, quantity: '25.000', expectedUnitPriceMinor: 8500 }, { listingId: ids.tomatoListing, quantity: '25.000', expectedUnitPriceMinor: 8500 }] }, { 'Idempotency-Key': randomUUID() })).status, 422);
});

test('RFQ quote acceptance freezes negotiated price and permits only one award', async () => {
  const rfq = await ok('POST', '/rfqs', 'buyer', { title: 'Tomatoes needed', category: 'produce', quantity: '30.000', unit: 'kg', targetPricePerUnitMinor: 7500, deliveryBy: date(24), deliveryLocation: loc, notes: 'Full quantity' });
  const quote = await ok('POST', `/rfqs/${rfq.id}/quotes`, 'supplier', { listingId: ids.tomatoListing, quantity: '30.000', pricePerUnitMinor: 7800, validUntil: date(12), notes: 'Fresh lot offer' });
  assert.equal((await request('POST', `/rfqs/${rfq.id}/quotes`, 'fisher', { listingId: ids.tunaListing, quantity: '30.000', pricePerUnitMinor: 7800, validUntil: date(12), notes: 'Wrong category' })).status, 422);
  const list = await ok('GET', '/rfqs', 'supplier'); assert.ok(list.some((r: any) => r.id === rfq.id && r.quotes[0].id === quote.id));
  const order = await ok('POST', `/quotes/${quote.id}/accept`, 'buyer', undefined, { 'Idempotency-Key': randomUUID() }); assert.equal(order.items[0].pricePerUnitMinor, 7800);
  assert.equal((await request('POST', `/quotes/${quote.id}/accept`, 'buyer', undefined, { 'Idempotency-Key': randomUUID() })).status, 409);
  await transition(order, 'cancelled', 'buyer');
});

test('complete fulfillment coordinates invoice, held funds, assigned carrier, manual telemetry and balanced ledger', async () => {
  let order = await newOrder();
  assert.equal((await request('POST', `/orders/${order.id}/payment`, 'buyer', { action: 'hold' }, { 'Idempotency-Key': randomUUID() })).status, 409);
  order = await transition(order, 'confirmed');
  const payment = await pay(order, 'hold'); assert.equal(payment.status, 'held'); assert.equal(payment.amountMinor, order.totalMinor);
  assert.equal((await request('POST', `/orders/${order.id}/payment`, 'buyer', { action: 'hold' }, { 'Idempotency-Key': randomUUID() })).status, 409);
  order = await transition(order, 'preparing'); order = await transition(order, 'ready_for_pickup');
  let shipment = await ok('POST', '/shipments', 'supplier', { orderId: order.id, logisticsOrgId: ids.logisticsOrg, pickupAt: date(1), expectedDeliveryAt: date(12), vehicleReference: 'TEST-TRUCK', temperatureMinC: 10, temperatureMaxC: 20 });
  assert.equal((await request('GET', `/shipments/${shipment.id}`, 'fisher')).status, 404);
  assert.equal((await request('POST', `/shipments/${shipment.id}/status`, 'supplier', { expectedVersion: shipment.version, status: 'picked_up' })).status, 403);
  shipment = await ok('POST', `/shipments/${shipment.id}/status`, 'logistics', { expectedVersion: shipment.version, status: 'picked_up' });
  const reading = await ok('POST', `/shipments/${shipment.id}/temperatures`, 'logistics', { measuredAt: date(0), temperatureC: 15, source: 'manual', deviceId: 'handheld' }); assert.equal(reading.excursion, false);
  const temperatures = await ok('GET', `/shipments/${shipment.id}/temperatures`, 'buyer'); assert.equal(temperatures[0].source, 'manual');
  shipment = await ok('GET', `/shipments/${shipment.id}`, 'logistics'); shipment = await ok('POST', `/shipments/${shipment.id}/status`, 'logistics', { expectedVersion: shipment.version, status: 'in_transit' });
  assert.equal((await request('POST', `/shipments/${shipment.id}/status`, 'logistics', { expectedVersion: shipment.version, status: 'delivered' })).status, 422);
  shipment = await ok('POST', `/shipments/${shipment.id}/status`, 'logistics', { expectedVersion: shipment.version, status: 'delivered', deliveryProof: 'Received by test restaurant manager' });
  await pay(order, 'release'); order = await transition(order, 'completed', 'buyer'); assert.equal(order.status, 'completed');
  const sum = (await db.query('SELECT sum(amount_minor) balance FROM ledger_entries WHERE payment_id=$1', [payment.id])).rows[0] as any; assert.equal(Number(sum.balance), 0);
});

test('temperature excursions stop shipment until administrator review', async () => {
  const id = '80000000-0000-4000-8000-000000000001';
  assert.equal((await request('POST', `/shipments/${id}/temperatures`, 'logistics', { measuredAt: date(5), temperatureC: 3, source: 'manual' })).status, 422);
  const reading = await ok('POST', `/shipments/${id}/temperatures`, 'logistics', { measuredAt: date(0), temperatureC: 12, source: 'manual' }); assert.equal(reading.excursion, true);
  let shipment = await ok('GET', `/shipments/${id}`, 'logistics'); assert.equal(shipment.status, 'exception');
  assert.equal((await request('POST', `/shipments/${id}/status`, 'logistics', { expectedVersion: shipment.version, status: 'in_transit', reason: 'Skip review' })).status, 403);
  assert.equal((await request('POST', `/shipments/${id}/status`, 'admin', { expectedVersion: shipment.version, status: 'scheduled', reason: 'Cannot rewind completed pickup' })).status, 403);
  shipment = await ok('POST', `/shipments/${id}/status`, 'admin', { expectedVersion: shipment.version, status: 'in_transit', reason: 'Manual thermometer fault reviewed with carrier' }); assert.equal(shipment.status, 'in_transit');
});

test('disputes freeze release and terminal refund cannot be applied twice', async () => {
  let order = await newOrder(); order = await transition(order, 'confirmed'); await pay(order, 'hold');
  const dispute = await ok('POST', '/disputes', 'buyer', { orderId: order.id, reason: 'Quality concern', description: 'Product appearance needs supplier investigation.' });
  assert.equal((await request('POST', `/orders/${order.id}/payment`, 'buyer', { action: 'release' }, { 'Idempotency-Key': randomUUID() })).status, 409);
  assert.equal((await request('POST', `/disputes/${dispute.id}/resolution`, 'supplier', { status: 'resolved_refund', resolution: 'Unauthorized' })).status, 403);
  await ok('POST', `/disputes/${dispute.id}/resolution`, 'admin', { status: 'under_review', resolution: 'Reviewing source evidence' });
  const resolved = await ok('POST', `/disputes/${dispute.id}/resolution`, 'admin', { status: 'resolved_refund', resolution: 'Refund approved after quality review' }); assert.equal(resolved.status, 'resolved_refund');
  assert.equal((await request('POST', `/disputes/${dispute.id}/resolution`, 'admin', { status: 'resolved_release', resolution: 'Duplicate resolution' })).status, 409);
  assert.equal((await ok('GET', `/orders/${order.id}/payment`, 'buyer')).status, 'refunded'); await transition(order, 'cancelled', 'buyer');
  assert.ok((await ok('GET', '/disputes', 'supplier')).some((d: any) => d.id === dispute.id));
});

test('held-order cancellation atomically refunds and admin refund requires reason', async () => {
  let order = await newOrder(); order = await transition(order, 'confirmed'); await pay(order, 'hold');
  assert.equal((await request('POST', `/orders/${order.id}/payment`, 'buyer', { action: 'refund' }, { 'Idempotency-Key': randomUUID() })).status, 403);
  await transition(order, 'cancelled', 'buyer'); assert.equal((await ok('GET', `/orders/${order.id}/payment`, 'buyer')).status, 'refunded');
  let other = await newOrder(); other = await transition(other, 'confirmed'); await pay(other, 'hold'); await pay(other, 'refund', 'admin', 'Administrative correction'); await transition(other, 'cancelled', 'admin', 'Refunded order cancelled');
});

test('recurring intentions and actual analytics expose phase limitations', async () => {
  const agreement = await ok('POST', '/agreements', 'buyer', { supplierOrgId: ids.supplierOrg, listingId: ids.riceListing, title: 'Weekly rice', quantity: '100.000', cadence: 'weekly', startsAt: date(24), endsAt: date(24 * 30) }); assert.equal(agreement.status, 'draft'); assert.equal(agreement.nextDeliveryAt, null);
  assert.ok((await ok('GET', '/agreements', 'supplier')).length > 0);
  for (const who of ['buyer', 'supplier', 'logistics', 'admin']) { const analytics = await ok('GET', '/analytics', who); assert.equal(analytics.scope, who === 'supplier' ? 'supplier' : who); assert.equal(analytics.forecast.method, 'insufficient_data'); if (who !== 'admin') assert.equal(analytics.metrics.pendingVerifications, 0); if (who === 'logistics') { assert.equal(analytics.metrics.grossOrderValueMinor, null); assert.ok(analytics.weeklyVolume.every((w: any) => w.orderValueMinor === null)); assert.deepEqual(analytics.priceTrends, []); } }
  assert.ok((await ok('GET', '/audit', 'admin')).length > 0); assert.equal((await request('GET', '/audit', 'buyer')).status, 403);
});

test('reservation expiry returns stock once and durable outbox contains authorized schema-shaped events', async () => {
  const order = await newOrder();
  await db.query("UPDATE orders SET reservation_expires_at=now()-interval '1 minute' WHERE id=$1", [order.id]);
  const before = await ok('GET', `/listings/${ids.tomatoListing}`, 'supplier');
  assert.equal((await server.market.runMaintenance()).expiredOrders, 1); assert.equal((await server.market.runMaintenance()).expiredOrders, 0);
  assert.equal((await ok('GET', `/orders/${order.id}`, 'buyer')).status, 'expired');
  const after = await ok('GET', `/listings/${ids.tomatoListing}`, 'supplier'); assert.equal(Number(after.availableQuantity) - Number(before.availableQuantity), 25);
  const rows = (await db.query('SELECT * FROM outbox_events')).rows as any[]; assert.ok(rows.length > 10); assert.ok(rows.every(r => ['listing.changed', 'order.created', 'order.status_changed', 'shipment.updated', 'payment.updated', 'verification.updated', 'dispute.updated'].includes(r.event_type)));
  await server.tick(); assert.equal(Number((await db.query('SELECT count(*) count FROM outbox_events WHERE published_at IS NULL')).rows[0].count), 0);
});

test('websocket authenticates namespace, derives tenant room and signals authoritative refetch', async () => {
  const socket = io(server.url + '/events', { transports: ['websocket'], auth: { accessToken: sessions.buyer.accessToken }, extraHeaders: { Origin: origin }, reconnection: false });
  try { const ready = await new Promise<any>((resolve, reject) => { const timer = setTimeout(() => reject(new Error('socket timeout')), 5000); socket.on('ready', r => { clearTimeout(timer); resolve(r); }); socket.on('connect_error', reject); }); assert.equal(ready.refetch, true); }
  finally { socket.disconnect(); }
  const denied = io(server.url + '/events', { transports: ['websocket'], auth: { accessToken: 'invalid' }, extraHeaders: { Origin: origin }, reconnection: false });
  try { await new Promise<void>((resolve, reject) => { const timer = setTimeout(() => reject(new Error('denial timeout')), 5000); denied.on('connect_error', e => { clearTimeout(timer); assert.equal(e.message, 'UNAUTHORIZED'); resolve(); }); }); } finally { denied.disconnect(); }
});

test('unknown endpoints and malformed JSON retain the API error envelope and request identifier', async () => {
  const missing = await request('GET', '/not-a-real-endpoint');
  assert.equal(missing.status, 404); assert.equal(missing.body.error.code, 'NOT_FOUND');
  assert.equal(typeof missing.body.error.requestId, 'string');
  const malformed = await fetch(server.url + '/api/v1/auth/login', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: '{broken' });
  const body = await malformed.json(); assert.equal(malformed.status, 400); assert.equal(body.error.code, 'INVALID_JSON');
  assert.equal(body.error.requestId, malformed.headers.get('x-request-id'));
  assert.equal(typeof body.error.requestId, 'string');
});

test('financial event revisions increase so clients do not discard later payment and dispute changes', async () => {
  const groups = (await db.query<any>("SELECT event_type,aggregate_id,organization_id,array_agg(aggregate_version ORDER BY occurred_at) AS revisions FROM outbox_events WHERE event_type IN ('payment.updated','dispute.updated') GROUP BY event_type,aggregate_id,organization_id HAVING count(*)>1")).rows;
  assert(groups.some(row => row.event_type === 'payment.updated'));
  assert(groups.some(row => row.event_type === 'dispute.updated'));
  for (const row of groups) {
    assert.equal(new Set(row.revisions).size, row.revisions.length);
    assert.deepEqual(row.revisions, [...row.revisions].sort((a: number, b: number) => a - b));
  }
});

test('a changed price after offline review rejects the order without reserving stock', async () => {
  const listing = await ok('GET', `/listings/${ids.tomatoListing}`, 'supplier');
  const intent = { items: [{ listingId: listing.id, quantity: '25.000', expectedUnitPriceMinor: listing.pricePerUnitMinor }], deliveryLocation: loc, deliveryBy: date(24), notes: 'Offline price review test' };
  const changed = await ok('PATCH', `/listings/${listing.id}`, 'supplier', { expectedVersion: listing.version, pricePerUnitMinor: listing.pricePerUnitMinor + 100 });
  const result = await request('POST', '/orders', 'buyer', intent, { 'Idempotency-Key': randomUUID() });
  assert.equal(result.status, 409); assert.equal(result.body.error.code, 'PRICE_CHANGED');
  const current = await ok('GET', `/listings/${listing.id}`, 'supplier');
  assert.equal(current.availableQuantity, listing.availableQuantity);
  await ok('PATCH', `/listings/${listing.id}`, 'supplier', { expectedVersion: changed.version, pricePerUnitMinor: listing.pricePerUnitMinor });
});
