import { eq } from 'drizzle-orm';
import { createApp } from './app.js';
import { EnvError, loadEnv, type Env } from './env.js';
import { createNodePgDb, createPgliteDb, listQueuedJobs, schema, setLinkState, updateJob, type Db } from './db/index.js';
import { SyncQueue } from './ingestion/index.js';
import { DEFAULT_FIXTURE_DIR, FixtureRiotClient, HttpRiotClient, type RiotClient } from './riot/index.js';
import { log } from './http/errors.js';
import { MockRsoProvider, RiotRsoProvider, type RsoProvider } from './http/rso.js';

/** Jobs left queued/running by a crash are marked failed; idempotent re-sync makes this safe. */
async function recoverInterruptedJobs(db: Db): Promise<number> {
  const queued = await listQueuedJobs(db);
  const running = await db.select().from(schema.ingestionJobs).where(eq(schema.ingestionJobs.state, 'running'));
  const message = 'Sync was interrupted by a restart. Sync again.';
  for (const job of [...queued, ...running]) {
    await updateJob(db, job.id, { state: 'failed', errorCategory: 'interrupted', errorMessage: message, finishedAt: new Date() });
    await setLinkState(db, job.userId, 'sync_failed', { lastError: message });
  }
  return queued.length + running.length;
}

async function main(): Promise<void> {
  let env: Env;
  try {
    env = loadEnv();
  } catch (err) {
    if (err instanceof EnvError) {
      console.error(err.message);
      process.exit(1);
    }
    throw err;
  }

  let closeDb: () => Promise<void> = async () => {};
  let db: Db;
  if (env.databaseUrl) {
    const pg = await createNodePgDb(env.databaseUrl);
    db = pg.db;
    closeDb = pg.close;
  } else {
    db = await createPgliteDb(env.pgliteDir);
  }

  const riot: RiotClient = env.demoMode
    ? new FixtureRiotClient({ dir: DEFAULT_FIXTURE_DIR })
    : new HttpRiotClient({ apiKey: env.riotApiKey as string });
  const rso: RsoProvider = env.demoMode
    ? new MockRsoProvider()
    : new RiotRsoProvider({
        clientId: env.rsoClientId as string,
        clientSecret: env.rsoClientSecret as string,
        redirectUri: env.rsoRedirectUri as string,
      });

  const recovered = await recoverInterruptedJobs(db);
  if (recovered > 0) log('recovered_interrupted_jobs', { count: recovered });

  const queue = new SyncQueue({ db, riot, rawRetentionDays: env.rawRetentionDays, log });
  const stopScheduler = env.syncIntervalMinutes > 0 ? queue.startScheduler(env.syncIntervalMinutes * 60_000) : () => {};

  const app = createApp({ db, riot, rso, queue, env });
  const server = app.listen(env.port, () => {
    log('listening', { port: env.port, demoMode: env.demoMode, database: env.databaseUrl ? 'postgres' : env.pgliteDir ? 'pglite-dir' : 'pglite-memory' });
  });

  let shuttingDown = false;
  const shutdown = (signal: string): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    log('shutdown', { signal });
    stopScheduler();
    const force = setTimeout(() => process.exit(1), 10_000);
    force.unref();
    server.close(() => {
      void queue
        .idle()
        .then(closeDb)
        .catch(() => {})
        .finally(() => process.exit(0));
    });
    server.closeIdleConnections();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error('Fatal startup error:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
