import { chromium } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import AxeBuilder from '@axe-core/playwright';

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1050 } });
const page = await context.newPage();
await mkdir('apps/web/test-results', { recursive: true });
try {
  await page.goto('http://127.0.0.1:3100');
  await page.getByRole('heading', { name: 'Welcome back.' }).waitFor();
  await page.screenshot({ path: 'apps/web/test-results/login.png', fullPage: true });
  const entry = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  console.log('Entry accessibility:', JSON.stringify(entry.violations.map(v => ({ id: v.id, impact: v.impact, targets: v.nodes.map(n => ({target:n.target,summary:n.failureSummary})) }))));
  if (process.env.DEMO_PASSWORD) {
    await page.getByLabel('Work email').fill('buyer@harvestlink.demo');
    await page.getByLabel('Password', { exact: true }).fill(process.env.DEMO_PASSWORD);
    await page.getByRole('button', { name: 'Sign in to your workspace' }).click();
    await page.getByRole('heading', { name: 'Fresh from the source.' }).waitFor();
    await page.getByRole('heading', { name: /Explore the marketplace/ }).waitFor();
    await page.screenshot({ path: 'apps/web/test-results/marketplace.png', fullPage: true });
    const buyer = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
    console.log('Marketplace accessibility:', JSON.stringify(buyer.violations.map(v => ({ id: v.id, impact: v.impact, targets: v.nodes.map(n => ({target:n.target,summary:n.failureSummary})) }))));
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: 'apps/web/test-results/mobile.png', fullPage: true });
    console.log('Mobile overflow:', await page.evaluate(() => document.documentElement.scrollWidth > innerWidth));
  }
} finally { await browser.close(); }
