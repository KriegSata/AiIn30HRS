import { test, expect, type Page, type APIRequestContext } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { mkdirSync, writeFileSync } from 'node:fs';

const unique = () => `QA-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
const password = () => { if (!process.env.DEMO_PASSWORD) throw new Error('Run npm run setup before E2E tests.'); return process.env.DEMO_PASSWORD; };
// Tests share one loopback address. Respect the real limiter when switching many
// identities; do not disable server throttling just to accelerate acceptance.
const rateWindow = async () => { console.info('Rate limit reached; waiting for the next one-minute window.'); await new Promise(resolve => setTimeout(resolve, 61_000)); };
async function login(page: Page, role: string) {
  await page.goto('/');
  await page.getByLabel('Work email').fill(`${role}@harvestlink.demo`);
  await page.getByLabel('Password', { exact: true }).fill(password());
  const isSignInResult = (r: import('@playwright/test').Response) => r.request().method() === 'POST' && (r.url().endsWith('/auth/login') || (r.url().endsWith('/auth/logout') && r.status() >= 400));
  const response = page.waitForResponse(isSignInResult);
  await page.getByRole('button', { name: 'Sign in to your workspace' }).click();
  let result = await response;
  if (result.status() === 429) {
    await rateWindow();
    const retry = page.waitForResponse(isSignInResult);
    await page.getByRole('button', { name: 'Sign in to your workspace' }).click();
    result = await retry;
  }
  expect(result.status()).toBe(200);
  await expect(page.getByRole('navigation', { name: 'Main navigation' })).toBeAttached();
  await expect(page.getByText('Loading your workspace…')).toHaveCount(0);
  return (await result.json()).data;
}
async function nav(page: Page, name: string) {
  const open = page.getByRole('button', { name: 'Open navigation', exact: true });
  if (await open.isVisible()) await open.click();
  const destination = page.getByRole('navigation').getByRole('button', { name: new RegExp(`^${name}(?:[ ]+[0-9]+)?$`) });
  if (!await destination.isVisible()) await page.locator('summary').filter({ hasText: 'Business tools' }).click();
  await destination.click();
}
async function logout(page: Page) {
  await nav(page, 'My organization');
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page.getByLabel('Work email')).toBeVisible();
}
async function call(request: APIRequestContext, session: any, path: string, method = 'GET', data?: unknown) {
  const options = {
    method, headers: { Authorization: `Bearer ${session.accessToken}`, Origin: 'http://127.0.0.1:3100', 'Idempotency-Key': unique() }, data,
  };
  let response = await request.fetch(`/api/v1${path}`, options);
  if (response.status() === 429) { await rateWindow(); response = await request.fetch(`/api/v1${path}`, options); }
  expect(response.ok(), `${method} ${path}: ${response.status()}`).toBeTruthy();
  return (await response.json()).data;
}
async function apiLogin(request: APIRequestContext, role: string) {
  const options = { headers: { Origin: 'http://127.0.0.1:3100' }, data: { email: `${role}@harvestlink.demo`, password: password() } };
  let response = await request.post('/api/v1/auth/login', options);
  if (response.status() === 429) { await rateWindow(); response = await request.post('/api/v1/auth/login', options); }
  expect(response.status()).toBe(200);
  return (await response.json()).data;
}
async function makeListing(request: APIRequestContext, supplier: any, title: string) {
  return call(request, supplier, '/listings', 'POST', {
    title, description: 'Fresh controlled QA lot for repeatable acceptance checks.', category: 'produce', unit: 'kg',
    pricePerUnitMinor: 9500, currency: 'PHP', quantity: '1000.000', minOrderQuantity: '1.000',
    location: supplier.organization.location, status: 'active',
    lot: { code: title, harvestedAt: new Date(Date.now() - 3600000).toISOString(), expiresAt: new Date(Date.now() + 604800000).toISOString(),
      origin: supplier.organization.location, catchMethod: 'not_applicable', coldChainStatus: 'ambient', storageMinC: 10, storageMaxC: 25,
      sourceType: 'farm', sourceName: 'QA Acceptance Farm' },
  });
}
async function openProduct(page: Page, title: string) {
  await page.getByRole('textbox', { name: 'Search products, suppliers or locations' }).fill(title);
  await page.getByRole('button', { name: title, exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
}
async function axe(page: Page, name: string) {
  const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  mkdirSync('artifacts', { recursive: true });
  writeFileSync(`artifacts/qa-axe-${name}.json`, JSON.stringify({ url: result.url, timestamp: result.timestamp, violations: result.violations, passes: result.passes.map(p => p.id), incomplete: result.incomplete.map(p => ({ id: p.id, nodes: p.nodes.map(n => n.target) })) }, null, 2));
  expect(result.violations.map(v => ({ id: v.id, impact: v.impact, nodes: v.nodes.map(n => n.target) }))).toEqual([]);
}

test('login and five role landing pages have no automated WCAG AA violations', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByLabel('Work email')).toBeVisible();
  await axe(page, 'login');
  for (const role of ['buyer', 'supplier', 'fisher', 'logistics', 'admin']) {
    await login(page, role);
    await axe(page, role);
    await page.screenshot({ path: `artifacts/qa-${role}-desktop.png`, fullPage: true });
    if (role === 'fisher') await expect(page.locator('tbody')).toContainText('Yellowfin tuna');
    if (role === 'buyer') await expect(page.getByRole('navigation').getByRole('button', { name: /^Verification/ })).toHaveCount(0);
    await logout(page);
  }
});

test('buyer search, cold filters, source details, keyboard dialog and mobile layout', async ({ page }) => {
  await login(page, 'buyer');
  await page.getByRole('combobox', { name: 'Category', exact: true }).selectOption('seafood');
  await expect(page.locator('.product-card')).toHaveCount(2);
  await page.locator('summary').filter({ hasText: 'More filters' }).click();
  await page.getByLabel('Chilled or frozen only').check();
  await page.getByRole('textbox', { name: 'Search products, suppliers or locations' }).fill('Yellowfin');
  await expect(page.locator('.product-card')).toHaveCount(1);
  await page.getByRole('button', { name: 'Yellowfin tuna', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog')).toContainText('DEMO-CATCH-002');
  await expect(page.getByRole('dialog')).toContainText('Handline');
  for (let index = 0; index < 18; index++) {
    await page.keyboard.press('Tab');
    expect(await page.evaluate(() => !!document.activeElement?.closest('dialog'))).toBe(true);
  }
  await axe(page, 'product-dialog');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Yellowfin tuna', exact: true })).toBeFocused();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('textbox', { name: 'Search products, suppliers or locations' }).fill('');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  await page.screenshot({ path: 'artifacts/qa-buyer-mobile.png', fullPage: true });
  await nav(page, 'Orders');
  await expect(page.getByRole('heading', { name: 'Your orders', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
});

test('supplier publishes and edits a lot; buyer orders; supplier fulfills; carrier delivers; buyer settles', async ({ page, request }) => {
  test.setTimeout(150_000);
  const title = unique();
  await login(page, 'supplier');
  await page.getByRole('button', { name: 'Add listing', exact: true }).click();
  await page.getByLabel('Product name', { exact: true }).fill(title);
  await page.getByLabel('Description', { exact: true }).fill('QA tomatoes harvested for the full transaction acceptance journey.');
  await page.getByLabel('Price per unit (PHP)', { exact: true }).fill('95');
  await page.getByLabel('Minimum order quantity', { exact: true }).fill('1');
  await page.getByLabel('Available quantity', { exact: true }).fill('1000');
  await page.getByLabel('Batch / lot code', { exact: true }).fill(title);
  await page.getByRole('button', { name: 'Publish listing', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  let listingRow = page.getByRole('row').filter({ hasText: title });
  await listingRow.getByRole('button', { name: 'Edit listing', exact: true }).click();
  await page.getByLabel('Price per unit (PHP)', { exact: true }).fill('96');
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(listingRow).toContainText('₱96');
  await logout(page);
  let buyer = await login(page, 'buyer');
  await openProduct(page, title);
  await page.getByLabel('Delivery notes (optional)').fill(title);
  const created = page.waitForResponse(r => r.url().endsWith('/orders') && r.request().method() === 'POST');
  await page.getByRole('button', { name: 'Place bulk order', exact: true }).click();
  expect((await created).status()).toBe(201);
  const order = (await (await created).json()).data;
  expect(order.items[0].lotCode).toBe(title);
  expect(order.items[0].pricePerUnitMinor).toBe(9600);
  await logout(page);
  await login(page, 'supplier');
  await nav(page, 'Orders');
  let card = page.locator('.order-card').filter({ hasText: order.orderNumber });
  await card.getByRole('button', { name: 'Confirm order', exact: true }).click();
  await expect(card).toContainText('confirmed');
  await card.getByRole('button', { name: 'Start preparing', exact: true }).click();
  await card.getByRole('button', { name: 'Ready for pickup', exact: true }).click();
  await card.getByRole('button', { name: 'Schedule pickup', exact: true }).click();
  await page.getByRole('combobox', { name: 'Logistics partner', exact: true }).selectOption({ label: 'CoolMove Logistics' });
  await page.getByLabel('Vehicle reference', { exact: true }).fill(title);
  const localDate = (hours: number) => { const d = new Date(Date.now() + hours * 3600000); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); };
  await page.getByLabel('Scheduled pickup', { exact: true }).fill(localDate(1));
  await page.getByLabel('Expected delivery', { exact: true }).fill(localDate(2));
  await page.getByLabel('Minimum temperature (°C)', { exact: true }).fill('0');
  await page.getByLabel('Maximum temperature (°C)', { exact: true }).fill('4');
  await page.getByRole('dialog').getByRole('button', { name: 'Schedule pickup', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await logout(page);
  await login(page, 'buyer');
  await nav(page, 'Orders');
  card = page.locator('.order-card').filter({ hasText: order.orderNumber });
  await card.getByRole('button', { name: 'Pay in sandbox', exact: true }).click();
  await expect(card).toContainText('held');
  await logout(page);
  await login(page, 'logistics');
  const shipment = page.locator('.shipment-card').filter({ hasText: order.orderNumber });
  await shipment.getByRole('button', { name: 'Add reading', exact: true }).click();
  await page.getByLabel('Temperature (°C)', { exact: true }).fill('2.5');
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(shipment).toContainText('2.5 °C');
  await shipment.getByRole('button', { name: 'Confirm pickup', exact: true }).click();
  await shipment.getByRole('button', { name: 'Start transit', exact: true }).click();
  await shipment.getByRole('button', { name: 'Record delivery', exact: true }).click();
  await page.getByLabel('Proof of delivery').fill(`Received by QA restaurant manager, receipt ${title}`);
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(shipment).toContainText('delivered');
  await logout(page);
  buyer = await login(page, 'buyer');
  await nav(page, 'Orders');
  card = page.locator('.order-card').filter({ hasText: order.orderNumber });
  await card.getByRole('button', { name: 'Release sandbox funds', exact: true }).click();
  await expect(card).toContainText('released');
  await card.getByRole('button', { name: 'Acknowledge delivery', exact: true }).click();
  await expect(card).toContainText('completed');
  const persisted = await call(request, buyer, `/orders/${order.id}`);
  expect(persisted.status).toBe('completed');
  expect(persisted.paymentStatus).toBe('released');
  await card.getByRole('button', { name: 'View order & invoice', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText(title);
  await expect(page.getByRole('dialog')).toContainText('Sandbox simulation');
});

test('offline order remains pending, reconnect submits exactly once, signout clears pending data', async ({ page, context, request }) => {
  const supplier = await apiLogin(request, 'supplier');
  const title = unique(); await makeListing(request, supplier, title);
  const buyer = await login(page, 'buyer');
  await openProduct(page, title);
  await page.getByLabel('Delivery notes (optional)').fill(title);
  await context.setOffline(true);
  await page.getByRole('button', { name: 'Place bulk order', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /1 order submission pending/ })).toBeVisible();
  let orders = await call(request, buyer, '/orders?pageSize=100');
  expect(orders.filter((order: any) => order.notes === title)).toHaveLength(0);
  const submitted = page.waitForResponse(r => r.url().endsWith('/orders') && r.request().method() === 'POST');
  await context.setOffline(false);
  expect((await submitted).status()).toBe(201);
  await expect(page.locator('.outbox-banner')).toHaveCount(0);
  await context.setOffline(true); await context.setOffline(false);
  orders = await call(request, buyer, '/orders?pageSize=100');
  expect(orders.filter((order: any) => order.notes === title)).toHaveLength(1);
  await openProduct(page, title);
  await context.setOffline(true);
  await page.getByRole('button', { name: 'Place bulk order', exact: true }).click();
  await expect(page.locator('.outbox-banner')).toBeVisible();
  // A controlled 409 retains the queued submission for account-isolation verification.
  const current = (await call(request, supplier, '/listings?pageSize=100')).find((l: any) => l.title === title);
  await call(request, supplier, `/listings/${current.id}`, 'PATCH', { expectedVersion: current.version, pricePerUnitMinor: 9700 });
  await context.setOffline(false);
  await page.getByRole('button', { name: /1 order submission pending/ }).click();
  await expect(page.getByRole('dialog')).toContainText('conflict');
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await logout(page);
  await login(page, 'fisher');
  await expect(page.locator('.outbox-banner')).toHaveCount(0);
  const remaining = await page.evaluate(() => new Promise<number>((resolve, reject) => {
    const opening = indexedDB.open('harvestlink-private-drafts', 1);
    opening.onerror = () => reject(opening.error);
    opening.onsuccess = () => { const database = opening.result; const all = database.transaction('orders').objectStore('orders').getAll(); all.onsuccess = () => { database.close(); resolve(all.result.length); }; };
  }));
  expect(remaining).toBe(0);
});

test('offline stale price becomes a reviewable conflict without reserving stock', async ({ page, context, request }) => {
  const supplier = await apiLogin(request, 'supplier');
  const title = unique(); const listing = await makeListing(request, supplier, title);
  const buyer = await login(page, 'buyer');
  await openProduct(page, title);
  await page.getByLabel('Delivery notes (optional)').fill(title);
  await context.setOffline(true);
  await page.getByRole('button', { name: 'Place bulk order', exact: true }).click();
  await expect(page.locator('.outbox-banner')).toBeVisible();
  await call(request, supplier, `/listings/${listing.id}`, 'PATCH', { expectedVersion: listing.version, pricePerUnitMinor: 11000 });
  const rejected = page.waitForResponse(r => r.url().endsWith('/orders') && r.request().method() === 'POST');
  await context.setOffline(false);
  expect((await rejected).status()).toBe(409);
  expect((await (await rejected).json()).error.code).toBe('PRICE_CHANGED');
  await page.getByRole('button', { name: /1 order submission pending/ }).click();
  await expect(page.getByRole('dialog')).toContainText('conflict');
  await expect(page.getByRole('button', { name: 'Discard draft and review current listing' })).toBeVisible();
  const orders = await call(request, buyer, '/orders?pageSize=100');
  expect(orders.filter((order: any) => order.notes === title)).toHaveLength(0);
  expect((await call(request, supplier, `/listings/${listing.id}`)).availableQuantity).toBe('1000.000');
});

test('admin verifies an organization and reviews a buyer dispute with an audit reason', async ({ page, request }) => {
  const supplier = await apiLogin(request, 'supplier');
  const listing = await makeListing(request, supplier, unique());
  const buyer = await login(page, 'buyer');
  const draft = await call(request, buyer, '/orders', 'POST', { items: [{ listingId: listing.id, quantity: '1.000', expectedUnitPriceMinor: listing.pricePerUnitMinor }], deliveryLocation: buyer.organization.location, deliveryBy: new Date(Date.now() + 86400000).toISOString(), notes: 'QA isolated dispute fixture' });
  await call(request, supplier, `/orders/${draft.id}/status`, 'POST', { expectedVersion: draft.version, status: 'confirmed' });
  await call(request, buyer, `/orders/${draft.id}/payment`, 'POST', { action: 'hold' });
  await page.reload();
  await expect(page.getByRole('navigation', { name: 'Main navigation' })).toBeAttached();
  await nav(page, 'Orders');
  const held = page.locator('.order-card').filter({ hasText: draft.orderNumber });
  await held.getByRole('button', { name: 'Report an issue', exact: true }).click();
  const reason = `QA acceptance evidence ${unique()}`;
  await page.getByLabel('Describe the issue').fill(reason);
  const created = page.waitForResponse(r => r.url().endsWith('/disputes') && r.request().method() === 'POST');
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  expect((await created).status()).toBe(201);
  const dispute = (await (await created).json()).data;
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await logout(page);
  const admin = await login(page, 'admin');
  await nav(page, 'Verification');
  const organization = page.getByRole('row').filter({ hasText: 'Laguna Family Farms' });
  await organization.getByRole('button', { name: 'Review', exact: true }).click();
  await page.getByRole('combobox', { name: 'Verification decision', exact: true }).selectOption('verified');
  await page.getByLabel('Review reason').fill('QA synthetic license evidence reviewed for acceptance test.');
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(organization).toContainText('verified');
  await nav(page, 'Disputes');
  const disputeCard = page.locator('.rfq-card').filter({ hasText: reason });
  await disputeCard.getByRole('button', { name: 'Review & resolve' }).click();
  await page.getByRole('combobox', { name: 'Decision', exact: true }).selectOption('resolved_refund');
  await page.getByLabel('Resolution and evidence').fill('QA evidence reviewed; refund authorized for synthetic acceptance order.');
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(disputeCard).toContainText('resolved refund');
  const rows = await call(request, admin, '/disputes?pageSize=100');
  expect(rows.find((row: any) => row.id === dispute.id).status).toBe('resolved_refund');
  expect((await call(request, admin, `/orders/${dispute.orderId}/payment`)).status).toBe('refunded');
  await nav(page, 'Audit trail');
  await page.getByRole('textbox', { name: 'Search audit events' }).fill('dispute');
  await expect(page.locator('tbody')).toContainText('dispute');
});

test('offline signout locks the shared device and revokes the old session on reconnect', async ({ page, context, request }) => {
  const supplier = await apiLogin(request, 'supplier');
  const title = unique(); await makeListing(request, supplier, title);
  const buyer = await login(page, 'buyer');
  await openProduct(page, title);
  await context.setOffline(true);
  await page.getByRole('button', { name: 'Place bulk order', exact: true }).click();
  await expect(page.locator('.outbox-banner')).toBeVisible();
  await logout(page);
  expect(await page.evaluate(() => localStorage.getItem('harvestlink-pending-signout'))).toBe('1');
  await expect(page.getByRole('navigation')).toHaveCount(0);
  const signedOut = page.waitForResponse(r => r.url().endsWith('/auth/logout'));
  await context.setOffline(false);
  expect((await signedOut).status()).toBe(204);
  await page.reload();
  await expect(page.getByLabel('Work email')).toBeVisible();
  const rejected = await request.get('/api/v1/orders', { headers: { Authorization: `Bearer ${buyer.accessToken}` } });
  expect(rejected.status()).toBe(401);
  await login(page, 'fisher');
  await expect(page.locator('.outbox-banner')).toHaveCount(0);
});

test('browser receives distinct authorized live events and refreshes order status', async ({ page, request }) => {
  test.setTimeout(150_000);
  const supplier = await apiLogin(request, 'supplier');
  const listing = await makeListing(request, supplier, unique());
  const frames: string[] = [];
  page.on('websocket', socket => {
    if (socket.url().includes('/socket.io/')) socket.on('framereceived', frame => frames.push(String(frame.payload)));
  });
  const buyer = await login(page, 'buyer');
  await expect.poll(() => frames.some(frame => frame.includes('"ready"'))).toBe(true);
  const draft = await call(request, buyer, '/orders', 'POST', { items: [{ listingId: listing.id, quantity: '1.000', expectedUnitPriceMinor: listing.pricePerUnitMinor }], deliveryLocation: buyer.organization.location, deliveryBy: new Date(Date.now() + 86400000).toISOString(), notes: unique() });
  await nav(page, 'Orders');
  const confirmed = await call(request, supplier, `/orders/${draft.id}/status`, 'POST', { expectedVersion: draft.version, status: 'confirmed' });
  const card = page.locator('.order-card').filter({ hasText: draft.orderNumber });
  await expect(card).toContainText('confirmed', { timeout: 25_000 });
  await expect.poll(() => frames.filter(frame => frame.includes('domain.event') && frame.includes(draft.id)).length, { timeout: 20_000 }).toBeGreaterThan(0);
  const count = frames.filter(frame => frame.includes('domain.event') && frame.includes(draft.id)).length;
  await call(request, supplier, `/orders/${draft.id}/status`, 'POST', { expectedVersion: confirmed.version, status: 'preparing' });
  await expect.poll(() => frames.filter(frame => frame.includes('domain.event') && frame.includes(draft.id)).length, { timeout: 25_000 }).toBeGreaterThan(count);
  await expect(card).toContainText('preparing');
});

test('category and supplier location combine, optional filters use explicit units, reset restores results', async ({ page }) => {
  await login(page, 'buyer');
  await expect(page.locator('.market-hero')).toHaveCount(0);
  await expect(page.getByRole('navigation', { name: 'Main navigation' }).getByRole('button')).toHaveCount(4);
  await page.getByRole('combobox', { name: 'Category', exact: true }).selectOption('seafood');
  await expect(page.locator('.product-card')).toHaveCount(2);
  await page.getByRole('combobox', { name: 'Location', exact: true }).selectOption({ label: 'Benguet, Cordillera' });
  await expect(page.locator('.product-card')).toHaveCount(0);
  await page.getByRole('button', { name: 'Reset all filters', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Yellowfin tuna', exact: true })).toBeVisible();
  await page.getByRole('combobox', { name: 'Category', exact: true }).selectOption('seafood');
  await page.getByRole('combobox', { name: 'Location', exact: true }).selectOption({ label: 'General Santos, South Cotabato' });
  await page.locator('summary').filter({ hasText: 'More filters' }).click();
  await page.getByRole('combobox', { name: 'Order unit', exact: true }).selectOption('kg');
  await page.getByLabel('Maximum price (PHP per kg)', { exact: true }).fill('300');
  await expect(page.locator('.product-card')).toHaveCount(1);
  await expect(page.locator('.product-card')).toContainText('Fresh whiteleg shrimp');
  await page.getByLabel('Minimum order at most (kg)', { exact: true }).fill('10');
  await expect(page.locator('.product-card')).toHaveCount(0);
  await page.getByRole('button', { name: 'Reset all filters', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Order unit', exact: true })).toHaveValue('all');
  await expect(page.getByLabel('Maximum price (PHP)', { exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Yellowfin tuna', exact: true })).toBeVisible();
  const firstProduct = await page.locator('.product-card').first().boundingBox();
  expect(firstProduct!.y).toBeLessThan(700);
});

test('catalog can load a second page and filter its supplier location', async ({ page }) => {
  let fixtures: any[] = [];
  await page.route('**/api/v1/listings?**', async route => {
    const response = await route.fetch(); const body = await response.json();
    if (!response.ok()) return route.fulfill({ response });
    if (!fixtures.length) fixtures = Array.from({ length: 101 }, (_, index) => ({ ...body.data[0], id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`, title: `Catalog pagination fixture ${index}`, location: { ...body.data[0].location, label: index === 100 ? 'Palawan test landing' : 'Test farm location' } }));
    const pageNumber = Number(new URL(route.request().url()).searchParams.get('page') || '1');
    await route.fulfill({ json: { data: fixtures.slice((pageNumber - 1) * 100, pageNumber * 100), meta: { page: pageNumber, pageSize: 100, total: 101 } } });
  });
  await login(page, 'buyer');
  await expect(page.locator('.product-card')).toHaveCount(100);
  await page.getByRole('button', { name: 'Load more products', exact: true }).click();
  await expect(page.locator('.product-card')).toHaveCount(101);
  await expect(page.getByRole('button', { name: 'Load more products', exact: true })).toHaveCount(0);
  await page.getByRole('combobox', { name: 'Location', exact: true }).selectOption('Palawan test landing');
  await expect(page.locator('.product-card')).toHaveCount(1);
  await expect(page.locator('.product-card')).toContainText('Catalog pagination fixture 100');
});
