import { defineConfig } from '@playwright/test';
import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';

if (existsSync('.env.local')) loadEnvFile('.env.local');
const edge = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
export default defineConfig({
  testDir: './tests/e2e', fullyParallel: false, workers: 1,
  timeout: 180_000, expect: { timeout: 15_000 }, retries: 0,
  reporter: [['list'], ['html', { open: 'never' }], ['json', { outputFile: 'artifacts/qa-e2e-report.json' }]],
  use: {
    actionTimeout: 15_000,
    baseURL: 'http://127.0.0.1:3100', viewport: { width: 1440, height: 1000 },
    launchOptions: existsSync(edge) ? { executablePath: edge } : {},
    screenshot: 'only-on-failure', trace: 'off',
  },
  webServer: {
    command: 'npm run dev', url: 'http://127.0.0.1:3100', reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
