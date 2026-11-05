import { loadEnvFile } from 'node:process';
loadEnvFile('.env.local');
if (process.env.DEMO_MODE !== 'true' || !process.env.DEMO_PASSWORD) {
  console.error('Demo credentials are disabled. Run npm run setup for a local demo.');
  process.exit(1);
}
console.log('Local synthetic demo accounts (never use these for real data):');
for (const role of ['buyer', 'supplier', 'fisher', 'logistics', 'admin']) console.log(`  ${role}@harvestlink.demo`);
console.log(`Password: ${process.env.DEMO_PASSWORD}`);
