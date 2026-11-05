import { loadEnvFile } from 'node:process';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
if (existsSync('.env.local')) loadEnvFile('.env.local');
const base = process.env.LOAD_API_URL || 'http://127.0.0.1:4000/api/v1';
if (!['127.0.0.1', 'localhost'].includes(new URL(base).hostname)) throw new Error('This bounded harness is restricted to local targets.');
const origin = process.env.UI_ORIGIN || 'http://127.0.0.1:3100';
const samples = [];
async function request(path, token, method = 'GET', body, key, metric) {
  const started = performance.now();
  const response = await fetch(`${base}${path}`, { method, headers: { 'Content-Type': 'application/json', Origin: origin, ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(key ? { 'Idempotency-Key': key } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const json = await response.json();
  if (metric) samples.push({ operation: metric, durationMs: performance.now() - started, status: response.status });
  if (!response.ok) throw new Error(`${method} ${path}: ${response.status} ${json.error?.code}`);
  return json.data;
}
const login = role => request('/auth/login', null, 'POST', { email: `${role}@harvestlink.demo`, password: process.env.DEMO_PASSWORD });
const buyer = await login('buyer'), supplier = await login('supplier');
const run = `QA-load-${Date.now()}`;
const listing = await request('/listings', supplier.accessToken, 'POST', { title: run, description: 'Bounded local load acceptance lot', category: 'produce', unit: 'kg', pricePerUnitMinor: 9000, currency: 'PHP', quantity: '1000.000', minOrderQuantity: '1.000', location: supplier.organization.location, status: 'active', lot: { code: run, harvestedAt: new Date(Date.now() - 3600000).toISOString(), expiresAt: new Date(Date.now() + 604800000).toISOString(), origin: supplier.organization.location, catchMethod: 'not_applicable', coldChainStatus: 'ambient', storageMinC: null, storageMaxC: null, sourceType: 'farm', sourceName: 'QA load fixture' } });
const started = performance.now();
let next = 0;
await Promise.all(Array.from({ length: 4 }, async () => {
  for (;;) {
    const iteration = next++; if (iteration >= 60) return;
    if (iteration % 6 !== 0) await request(`/listings?search=${iteration % 2 ? 'tomato' : 'rice'}&pageSize=20`, buyer.accessToken, 'GET', undefined, undefined, 'listing_search');
    else {
      const key = randomUUID(); const body = { items: [{ listingId: listing.id, quantity: '1.000', expectedUnitPriceMinor: listing.pricePerUnitMinor }], deliveryLocation: buyer.organization.location, deliveryBy: new Date(Date.now() + 86400000).toISOString(), notes: run };
      const order = await request('/orders', buyer.accessToken, 'POST', body, key, 'order_create');
      const replay = await request('/orders', buyer.accessToken, 'POST', body, key, 'order_replay');
      if (order.id !== replay.id) throw new Error('Idempotent replay created a second order');
      await request(`/orders/${order.id}/status`, buyer.accessToken, 'POST', { expectedVersion: order.version, status: 'cancelled', reason: 'QA bounded load cleanup' });
    }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
}));
const after = await request(`/listings/${listing.id}`, supplier.accessToken);
if (after.availableQuantity !== '1000.000' || after.reservedQuantity !== '0.000') throw new Error('Reservation reconciliation failed');
await request(`/listings/${listing.id}`, supplier.accessToken, 'PATCH', { expectedVersion: after.version, status: 'paused' });
const metrics = Object.fromEntries(['listing_search', 'order_create', 'order_replay'].map(operation => {
  const rows = samples.filter(sample => sample.operation === operation); const times = rows.map(row => row.durationMs).sort((a, b) => a - b);
  return [operation, { requests: rows.length, errors: rows.filter(row => row.status >= 400).length, p50Ms: Number(times[Math.floor(times.length * .5)].toFixed(2)), p95Ms: Number(times[Math.min(times.length - 1, Math.ceil(times.length * .95) - 1)].toFixed(2)), maxMs: Number(times.at(-1).toFixed(2)) }];
}));
const report = { executedAt: new Date().toISOString(), tool: 'Node fetch bounded harness (not k6)', target: base, concurrency: 4, measuredRequests: samples.length, elapsedMs: Math.round(performance.now() - started), metrics, checks: { allResponsesSuccessful: samples.every(sample => sample.status < 400), tenIdempotentReplays: true, allReservationsReturned: true }, limitations: 'Local development API and embedded PostgreSQL; no production capacity claim. Authentication and cleanup are outside latency measurements.' };
mkdirSync('artifacts', { recursive: true }); writeFileSync('artifacts/qa-load-report.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
if (Object.values(metrics).some(metric => metric.p95Ms > 1500 || metric.errors)) process.exitCode = 1;
