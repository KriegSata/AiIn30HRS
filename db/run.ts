import { openDatabase } from '../apps/api/src/database.js';
import { hashDemoPassword, seedDatabase } from './seed.js';

async function main() {
  const database = await openDatabase();
  try {
    if (process.argv.includes('--seed')) {
      if (process.env.DEMO_MODE !== 'true') throw new Error('Set DEMO_MODE=true to seed synthetic demo identities');
      if (!process.env.DEMO_PASSWORD) throw new Error('DEMO_PASSWORD must be supplied explicitly; run npm run setup');
      const result = await seedDatabase(database, { passwordHash: hashDemoPassword(process.env.DEMO_PASSWORD) });
      process.stdout.write(`${result.seeded ? 'Seeded' : 'Preserved existing'} demo data in ${database.kind}.\n`);
    } else process.stdout.write(`Migrations verified for ${database.kind}.\n`);
  } finally { await database.close(); }
}
main().catch(error => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
