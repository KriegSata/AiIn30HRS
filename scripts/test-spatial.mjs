import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { postgis } from '@electric-sql/pglite-postgis';
import { seedDatabase, hashDemoPassword } from '../dist/api/db/seed.js';
import { DEMO_IDS } from '../dist/api/contracts/domain.js';

const pg = new PGlite({ extensions: { postgis } });
const adapt = client => ({ query: (sql, params) => client.query(sql, params), exec: sql => client.exec(sql) });
const db = { ...adapt(pg), transaction: fn => pg.transaction(tx => fn(adapt(tx))) };
try {
  for (const migration of ['001_core.sql', '002_postgis.sql', '003_inventory_total_cap.sql']) await pg.exec(await readFile(`db/migrations/${migration}`, 'utf8'));
  await seedDatabase(db, { passwordHash: hashDemoPassword('SpatialTestOnly2026!') });
  const version = (await pg.query('SELECT PostGIS_Version() AS version')).rows[0].version;
  const origin = (await pg.query('SELECT ST_X(origin_geog::geometry) AS lon,ST_Y(origin_geog::geometry) AS lat FROM lots WHERE supplier_org_id=$1 LIMIT 1', [DEMO_IDS.supplierOrg])).rows[0];
  assert.equal(origin.lon, 120.591); assert.equal(origin.lat, 16.452);
  const nearby = await pg.query('SELECT id FROM listings WHERE ST_DWithin(location_geog,ST_SetSRID(ST_MakePoint($1,$2),4326)::geography,$3)', [120.591, 16.452, 1000]);
  assert.equal(nearby.rows.length, 4);
  assert(!nearby.rows.some(row => row.id === DEMO_IDS.tunaListing));
  const indexes = await pg.query("SELECT indexname FROM pg_indexes WHERE indexdef LIKE '%USING gist%'");
  assert.equal(indexes.rows.length, 3);
  await pg.query('UPDATE organizations SET longitude=121,latitude=15 WHERE id=$1', [DEMO_IDS.supplierOrg]);
  assert.equal((await pg.query('SELECT ST_X(location_geog::geometry) AS lon FROM organizations WHERE id=$1', [DEMO_IDS.supplierOrg])).rows[0].lon, 121);
  await mkdir('artifacts', { recursive: true });
  await writeFile('artifacts/spatial-report.json', JSON.stringify({ runtime: 'PGlite experimental PostGIS extension; native cloud PostGIS not verified', version, generatedAt: new Date().toISOString(), checks: ['all migrations execute', 'longitude/latitude ordering preserved', 'radius query includes four farm listings and excludes distant seafood', 'three GiST indexes exist', 'generated geography updates with source coordinates'], passed: 5 }, null, 2) + '\n');
  console.log(`PASS 5 spatial migration checks on PostGIS ${version}. Native deployment remains a separate check.`);
} finally { await pg.close(); }
