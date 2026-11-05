import { randomBytes } from 'node:crypto';
import { existsSync, writeFileSync, mkdirSync } from 'node:fs';
if (!existsSync('.env.local')) {
  const secret = randomBytes(48).toString('hex');
  const password = randomBytes(12).toString('base64url') + '!a1';
  writeFileSync('.env.local', `API_PORT=4000\nUI_ORIGIN=http://127.0.0.1:3100\nAPI_INTERNAL_URL=http://127.0.0.1:4000\nDEMO_MODE=true\nSEED_DEMO=true\nDEMO_PASSWORD=${password}\nJWT_SECRET=${secret}\nPGLITE_DATA_DIR=.data/harvestlink\n`, { mode: 0o600 });
  console.log('Created .env.local with random local secrets. Demo password is in that ignored file.');
} else console.log('Keeping existing .env.local.');
mkdirSync('.data', { recursive: true });
