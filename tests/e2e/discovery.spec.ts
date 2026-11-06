import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

let lastLogin = 0;
async function signIn(page: Page) {
  const delay = 12000 - (Date.now() - lastLogin);
  if (delay > 0) await new Promise(resolve => setTimeout(resolve, delay));
  lastLogin = Date.now();
  await page.goto('/');
  await page.getByLabel('Work email').fill('buyer@harvestlink.demo');
  await page.getByLabel('Password', { exact: true }).fill(process.env.DEMO_PASSWORD!);
  const response = page.waitForResponse(r => r.url().endsWith('/auth/login') && r.request().method() === 'POST');
  await page.getByRole('button', { name: 'Sign in to your workspace' }).click();
  expect((await response).status()).toBe(200);
  await expect(page.locator('.product-card').first()).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Sort products' })).toHaveValue('recommended');
}
const catalogResponse = (page: Page, sort: string) => page.waitForResponse(r => {
  const url = new URL(r.url());
  return url.pathname === '/api/v1/listings' && url.searchParams.get('sort') === sort && r.ok();
});

test('discovery ignores cancelled location callbacks and clears location on signout', async ({ page }) => {
  await page.addInitScript(() => {
    (window as any).__locationCalls = 0;
    Object.defineProperty(navigator, 'geolocation', { configurable: true, value: {
      getCurrentPosition: (success: unknown) => {
        (window as any).__locationCalls++;
        (window as any).__locationSuccess = success;
      },
    } });
  });
  await signIn(page);
  await page.getByRole('button', { name: 'Enable location', exact: true }).click();
  await page.getByRole('button', { name: 'Not now', exact: true }).click();
  await page.evaluate(() => (window as any).__locationSuccess({ coords: { latitude: 6.12, longitude: 125.17 } }));
  await expect(page.getByRole('combobox', { name: 'Sort products' })).toContainText('Most popular');
  await page.getByRole('button', { name: 'Enable location', exact: true }).click();
  const nearby = catalogResponse(page, 'nearest');
  await page.evaluate(() => (window as any).__locationSuccess({ coords: { latitude: 6.12, longitude: 125.17 } }));
  await nearby;
  await expect(page.getByRole('combobox', { name: 'Sort products' })).toContainText('Nearest suppliers');
  await page.getByRole('button', { name: 'My organization', exact: true }).click();
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page.getByLabel('Work email')).toBeVisible();
  await signIn(page);
  await expect(page.getByRole('combobox', { name: 'Sort products' })).toContainText('Most popular');
  expect(await page.evaluate(() => (window as any).__locationCalls)).toBe(0);
});

test('discovery uses actual browser consent for nearby ranking and can return to popular', async ({ page, context }) => {
  await context.grantPermissions(['geolocation'], { origin: 'http://127.0.0.1:3100' });
  await context.setGeolocation({ latitude: 6.11641, longitude: 125.17162, accuracy: 500 });
  const listingQueries: URL[] = [];
  page.on('request', r => { if (new URL(r.url()).pathname === '/api/v1/listings') listingQueries.push(new URL(r.url())); });
  await signIn(page);
  expect(listingQueries.length).toBeGreaterThan(0);
  expect(listingQueries.every(url => url.searchParams.get('sort') === 'popular' && !url.searchParams.has('latitude'))).toBe(true);
  await expect(page.getByRole('combobox', { name: 'Sort products' })).toContainText('Most popular');
  const nearby = catalogResponse(page, 'nearest');
  await page.getByRole('button', { name: 'Enable location', exact: true }).click();
  const response = await nearby;
  const url = new URL(response.url());
  expect(url.searchParams.get('latitude')).toBe('6.12');
  expect(url.searchParams.get('longitude')).toBe('125.17');
  const ranked = (await response.json()).data;
  expect(ranked[0].category).toBe('seafood');
  await expect(page.locator('.product-title').first()).toHaveText(ranked[0].title);
  await expect(page.getByRole('combobox', { name: 'Sort products' })).toContainText('Nearest suppliers');
  await page.getByRole('combobox', { name: 'Sort products' }).selectOption('fresh');
  await expect(page.getByRole('combobox', { name: 'Sort products' })).toHaveValue('fresh');
  const popular = catalogResponse(page, 'popular');
  await page.getByRole('button', { name: 'Use popular products', exact: true }).click();
  const popularResponse = await popular;
  expect(new URL(popularResponse.url()).searchParams.has('latitude')).toBe(false);
  await page.getByRole('combobox', { name: 'Sort products' }).selectOption('recommended');
  await expect(page.locator('.product-title').first()).toHaveText((await popularResponse.json()).data[0].title);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Enable location', exact: true })).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Sort products' })).toContainText('Most popular');
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  const audit = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  expect(audit.violations).toEqual([]);
});

test('discovery not now does not request location; denial leaves popular products usable', async ({ page }) => {
  await page.addInitScript(() => {
    (window as any).__locationCalls = 0;
    Object.defineProperty(navigator, 'geolocation', { configurable: true, value: {
      getCurrentPosition: (_success: unknown, failure: (error: { code: number }) => void) => {
        (window as any).__locationCalls++; failure({ code: 1 });
      },
    } });
  });
  const queries: URL[] = [];
  page.on('request', r => { if (new URL(r.url()).pathname === '/api/v1/listings') queries.push(new URL(r.url())); });
  await signIn(page);
  await page.getByRole('button', { name: 'Not now', exact: true }).click();
  expect(await page.evaluate(() => (window as any).__locationCalls)).toBe(0);
  await page.getByRole('button', { name: 'Enable location', exact: true }).click();
  expect(await page.evaluate(() => (window as any).__locationCalls)).toBe(1);
  await expect(page.getByRole('combobox', { name: 'Sort products' })).toContainText('Most popular');
  await expect(page.getByText(/browser.*settings|permission.*blocked|location.*blocked/i).first()).toBeVisible();
  expect(queries.every(url => !url.searchParams.has('latitude'))).toBe(true);
  await page.getByRole('group', { name: 'Browse product categories' }).getByRole('button', { name: 'Seafood', exact: true }).click();
  await expect(page.locator('.product-card')).toHaveCount(2);
});

for (const failure of ['unavailable', 'timeout', 'unsupported'] as const) {
  test(`discovery ${failure} falls back to popular without coordinates`, async ({ page }) => {
    await page.addInitScript(mode => {
      Object.defineProperty(navigator, 'geolocation', { configurable: true, value: mode === 'unsupported' ? undefined : {
        getCurrentPosition: (_success: unknown, error: (failure: { code: number }) => void) => error({ code: mode === 'timeout' ? 3 : 2 }),
      } });
    }, failure);
    await signIn(page);
    await page.getByRole('button', { name: 'Enable location', exact: true }).click();
    await expect(page.getByRole('combobox', { name: 'Sort products' })).toContainText('Most popular');
    await expect(page.getByRole('button', { name: 'Enable location', exact: true })).toBeEnabled();
    await expect(page.locator('.product-card').first()).toBeVisible();
  });
}

test('discovery clearing location ignores a late nearest response', async ({ page, context }) => {
  await context.grantPermissions(['geolocation'], { origin: 'http://127.0.0.1:3100' });
  await context.setGeolocation({ latitude: 6.12, longitude: 125.17 });
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  let started!: () => void;
  const requested = new Promise<void>(resolve => { started = resolve; });
  await page.route('**/api/v1/listings?**', async route => {
    if (new URL(route.request().url()).searchParams.get('sort') !== 'nearest') return route.continue();
    const response = await route.fetch();
    started(); await held;
    await route.fulfill({ response });
  });
  await signIn(page);
  const firstPopular = await page.locator('.product-title').first().innerText();
  await page.getByRole('button', { name: 'Enable location', exact: true }).click();
  await requested;
  const popular = catalogResponse(page, 'popular');
  await page.getByRole('button', { name: 'Use popular products', exact: true }).click();
  await popular;
  const late = catalogResponse(page, 'nearest');
  release(); await late;
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await expect(page.getByRole('combobox', { name: 'Sort products' })).toContainText('Most popular');
  await expect(page.locator('.product-title').first()).toHaveText(firstPopular);
});
