import { openDatabase } from './database.js';
import { createServer } from './server.js';
import { hashPassword } from './core.js';
import { seedDatabase } from '../../../db/seed.js';

async function main() {
  const production = process.env.NODE_ENV === 'production';
  if (production) throw new Error('Production startup is disabled until live payment/messaging adapters, distributed limits, and production security review are complete. Use a private staging/demo environment.');
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 32) throw new Error('Run npm run setup to configure a unique JWT_SECRET.');
  const db = await openDatabase({ connectionString: process.env.DATABASE_URL, dataDir: process.env.PGLITE_DATA_DIR ?? '.data/harvestlink', migrate: process.env.RUN_MIGRATIONS !== 'false', production });
  if (process.env.SEED_DEMO === 'true') {
    const password = process.env.DEMO_PASSWORD;
    if (!password || password.length < 12) throw new Error('SEED_DEMO requires a DEMO_PASSWORD of at least twelve characters.');
    await seedDatabase(db, { passwordHash: await hashPassword(password) });
  }
  const server = await createServer(db, { secret, production, uiOrigin: process.env.UI_ORIGIN ?? 'http://localhost:3000', sandbox: process.env.DEMO_MODE === 'true', port: Number(process.env.API_PORT ?? 4000), host: process.env.API_HOST ?? '127.0.0.1' });
  console.log(JSON.stringify({ level: 'info', event: 'api_started', url: server.url, mode: 'local-demo', database: db.kind }));
  const stop = async () => { await server.close(); await db.close(); process.exit(0); };
  process.once('SIGTERM', stop); process.once('SIGINT', stop);
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
