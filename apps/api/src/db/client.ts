import { fileURLToPath } from 'node:url';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import { PGlite } from '@electric-sql/pglite';
import { drizzle as drizzlePglite } from 'drizzle-orm/pglite';
import { migrate as migratePglite } from 'drizzle-orm/pglite/migrator';
import { drizzle as drizzlePg } from 'drizzle-orm/node-postgres';
import { migrate as migratePg } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import * as schema from './schema.js';

/** Driver-agnostic database handle: works for node-postgres and PGlite. */
export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

const migrationsFolder = fileURLToPath(new URL('../../drizzle', import.meta.url));

/** In-memory when `dataDir` is undefined. Runs migrations. */
export async function createPgliteDb(dataDir?: string): Promise<Db> {
  const client = dataDir === undefined ? new PGlite() : new PGlite(dataDir);
  const db = drizzlePglite(client, { schema });
  await migratePglite(db, { migrationsFolder });
  return db as unknown as Db;
}

/** Production driver. Runs migrations. */
export async function createNodePgDb(connectionString: string): Promise<{ db: Db; close(): Promise<void> }> {
  const pool = new pg.Pool({ connectionString });
  const db = drizzlePg(pool, { schema });
  await migratePg(db, { migrationsFolder });
  return { db: db as unknown as Db, close: () => pool.end() };
}
