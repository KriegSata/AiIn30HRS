// Requires a disposable staging environment and explicit credentials through environment variables.
// k6 run --summary-export=artifacts/qa-k6-report.json tests/load/marketplace.k6.js
import http from 'k6/http';
import { check } from 'k6';
import exec from 'k6/execution';

const base = __ENV.LOAD_API_URL || 'http://127.0.0.1:4000/api/v1';
const origin = __ENV.UI_ORIGIN || 'http://127.0.0.1:3100';
export const options = {
  scenarios: {
    search: { executor: 'constant-arrival-rate', exec: 'search', rate: 2, timeUnit: '1s', duration: '30s', preAllocatedVUs: 2, maxVUs: 4 },
    order: { executor: 'shared-iterations', exec: 'order', vus: 2, iterations: 10, maxDuration: '30s' },
  },
  thresholds: { http_req_failed: ['rate<0.01'], http_req_duration: ['p(95)<1500'], checks: ['rate==1'], dropped_iterations: ['count==0'] },
};
function params(token, key) { return { headers: { Authorization: `Bearer ${token}`, Origin: origin, 'Content-Type': 'application/json', ...(key ? { 'Idempotency-Key': key } : {}) } }; }
export function setup() {
  if (!__ENV.DEMO_PASSWORD) throw new Error('DEMO_PASSWORD must be supplied securely in the process environment.');
  const authenticate = role => { const r = http.post(`${base}/auth/login`, JSON.stringify({ email: `${role}@harvestlink.demo`, password: __ENV.DEMO_PASSWORD }), params('')); if (r.status !== 200) throw new Error(`Login failed: ${r.status}`); return r.json('data'); };
  const supplier = authenticate('supplier'); const buyer = authenticate('buyer');
  const title = `QA-k6-${Date.now()}`;
  const listing = http.post(`${base}/listings`, JSON.stringify({ title, description: 'Disposable load acceptance lot', category: 'produce', unit: 'kg', pricePerUnitMinor: 9000, currency: 'PHP', quantity: '1000.000', minOrderQuantity: '1.000', location: supplier.organization.location, status: 'active', lot: { code: title, harvestedAt: new Date(Date.now() - 3600000).toISOString(), expiresAt: new Date(Date.now() + 604800000).toISOString(), origin: supplier.organization.location, catchMethod: 'not_applicable', coldChainStatus: 'ambient', storageMinC: null, storageMaxC: null, sourceType: 'farm', sourceName: 'QA load fixture' } }), params(supplier.accessToken));
  if (listing.status !== 201) throw new Error(`Fixture failed: ${listing.status}`);
  return { buyer, listing: listing.json('data'), run: title };
}
export function search(data) {
  const r = http.get(`${base}/listings?search=tomato&pageSize=20`, params(data.buyer.accessToken));
  check(r, { 'search responds 200 with list': response => response.status === 200 && Array.isArray(response.json('data')) });
}
export function order(data) {
  const key = `${data.run}-${exec.scenario.iterationInTest}`;
  const body = JSON.stringify({ items: [{ listingId: data.listing.id, quantity: '1.000', expectedUnitPriceMinor: data.listing.pricePerUnitMinor }], deliveryLocation: data.buyer.organization.location, deliveryBy: new Date(Date.now() + 86400000).toISOString(), notes: key });
  const r = http.post(`${base}/orders`, body, params(data.buyer.accessToken, key));
  check(r, { 'order accepted': response => response.status === 201 });
  if (r.status !== 201) return;
  const created = r.json('data');
  const replay = http.post(`${base}/orders`, body, params(data.buyer.accessToken, key));
  check(replay, { 'retry returns the same order': response => response.status === 201 && response.json('data.id') === created.id });
  const cancelled = http.post(`${base}/orders/${created.id}/status`, JSON.stringify({ expectedVersion: created.version, status: 'cancelled', reason: 'Disposable load fixture cleanup' }), params(data.buyer.accessToken));
  check(cancelled, { 'stock reservation returned': response => response.status === 200 });
}
