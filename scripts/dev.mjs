import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
if (!existsSync('.env.local')) await import('./setup.mjs');
loadEnvFile('.env.local');
const children = [
  spawn(process.execPath, ['--import', 'tsx', 'apps/api/src/main.ts'], { stdio: 'inherit', env: process.env }),
  spawn(process.execPath, ['node_modules/next/dist/bin/next', 'dev', 'apps/web', '--hostname', '127.0.0.1', '--port', '3100'], { stdio: 'inherit', env: process.env }),
];
let stopping = false;
function stop(code = 0) { if (stopping) return; stopping = true; for (const child of children) child.kill(); process.exitCode = code; }
for (const child of children) child.on('exit', code => stop(code ?? 1));
process.on('SIGINT', () => stop());
process.on('SIGTERM', () => stop());
