import { PGlite } from '@electric-sql/pglite';
import pg from 'pg';
import { createHash } from 'node:crypto';
import { readFile, readdir, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

export interface QueryResult<T> { rows: T[]; rowCount: number }
export interface Queryable {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<QueryResult<T>>;
  exec(sql: string): Promise<void>;
}
export interface Database extends Queryable {
  kind: 'postgres' | 'pglite';
  transaction<T>(callback: (client: Queryable) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}
export interface DatabaseOptions {
  connectionString?: string;
  dataDir?: string;
  migrate?: boolean;
  production?: boolean;
  migrationsDir?: string;
}
type NativeClient = Pick<pg.Pool, 'query'> | Pick<pg.PoolClient, 'query'>;

function nativeQueryable(client: NativeClient): Queryable {
  return {
    async query<T>(sql: string, params: unknown[] = []) {
      const result = await client.query(sql, params);
      return { rows: result.rows as T[], rowCount: result.rowCount ?? 0 };
    },
    async exec(sql: string) { await client.query(sql); },
  };
}

/** Native PostgreSQL in production; local PGlite is deliberately one process only. */
export async function openDatabase(options: DatabaseOptions = {}): Promise<Database> {
  const production = options.production ?? process.env.NODE_ENV === 'production';
  const connectionString = options.connectionString ?? process.env.DATABASE_URL;
  if (production && !connectionString) throw new Error('Production requires DATABASE_URL for PostgreSQL/PostGIS');
  let database: Database;
  if (connectionString) {
    const pool = new pg.Pool({ connectionString, max: 12, connectionTimeoutMillis: 10000, idleTimeoutMillis: 30000 });
    database = {
      kind: 'postgres', ...nativeQueryable(pool),
      async transaction<T>(callback: (client: Queryable) => Promise<T>) {
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          const result = await callback(nativeQueryable(client));
          await client.query('COMMIT');
          return result;
        } catch (error) {
          await client.query('ROLLBACK');
          throw error;
        } finally { client.release(); }
      },
      async close() { await pool.end(); },
    };
  } else {
    const dataDir = options.dataDir ?? process.env.DB_DIR ?? process.env.PGLITE_DATA_DIR ?? resolve(process.cwd(), '.data', 'harvestlink');
    if (dataDir !== 'memory://' && dataDir !== ':memory:') await mkdir(dataDir, { recursive: true });
    const pglite = new PGlite(dataDir === ':memory:' ? 'memory://' : dataDir);
    await pglite.waitReady;
    const adapt = (client: Pick<PGlite, 'query' | 'exec'>): Queryable => ({
      async query<T>(sql: string, params: unknown[] = []) {
        const result = await client.query<T>(sql, params);
        return { rows: result.rows as T[], rowCount: result.rowCount ?? result.affectedRows ?? result.rows.length };
      },
      async exec(sql: string) { await client.exec(sql); },
    });
    database = {
      kind: 'pglite', ...adapt(pglite),
      async transaction<T>(callback: (client: Queryable) => Promise<T>) {
        return pglite.transaction(async tx => callback(adapt(tx)));
      },
      async close() { await pglite.close(); },
    };
  }
  try {
    await database.query('SELECT 1');
    if (options.migrate !== false) await migrateDatabase(database, options.migrationsDir);
    if (production) await database.query('SELECT PostGIS_Version()');
    return database;
  } catch (error) {
    await database.close();
    throw error;
  }
}

/** Serialized, checksum-verified migrations. Use separate migration credentials in production. */
export async function migrateDatabase(database: Database, directory?: string): Promise<void> {
  const migrationsDir = directory ?? process.env.MIGRATIONS_DIR ?? resolve(process.cwd(), 'db/migrations');
  await database.transaction(async tx => {
    // PGlite serializes its single connection. Native servers need a cross-process migration lock.
    if (database.kind === 'postgres') await tx.query('SELECT pg_advisory_xact_lock(731826492)');
    await tx.exec('CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, checksum TEXT NOT NULL, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())');
    const names = (await readdir(migrationsDir)).filter(name => /^\d+_.+\.sql$/.test(name)).sort();
    for (const name of names) {
      if (name.includes('_postgis') && database.kind === 'pglite') continue;
      const sql = await readFile(resolve(migrationsDir, name), 'utf8');
      const checksum = createHash('sha256').update(sql).digest('hex');
      const existing = await tx.query<{ checksum: string }>('SELECT checksum FROM schema_migrations WHERE name=$1', [name]);
      if (existing.rows.length) {
        if (existing.rows[0]!.checksum !== checksum) throw new Error(`Migration ${name} has changed since application`);
        continue;
      }
      await tx.exec(sql);
      await tx.query('INSERT INTO schema_migrations(name,checksum) VALUES($1,$2)', [name, checksum]);
    }
  });
}
