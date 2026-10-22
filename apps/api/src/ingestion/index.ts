import { normalizeMatch, toPlayerRecord } from '@va/core';
import type { NormalizedMatch } from '@va/shared';
import {
  createOrGetActiveJob,
  getRiotAccount,
  hasPlayerRecord,
  listLinkedAccounts,
  purgeExpiredRawPayloads,
  replacePlayerRounds,
  saveRawPayload,
  setLinkState,
  updateJob,
  upsertContent,
  upsertMatch,
  upsertPlayerRecord,
  type Db,
  type JobRow,
  type PlayerRoundRow,
} from '../db/index.js';
import { RiotApiError, createLimiter, type RiotClient, type RiotShard } from '../riot/index.js';


export interface IngestionDeps {
  db: Db;
  riot: RiotClient;
  now?: () => Date;
  /** concurrent match fetches, default 4 */
  concurrency?: number;
  /** raw payload retention, default 30 */
  rawRetentionDays?: number;
  log?: (event: string, fields: Record<string, unknown>) => void;
}

export const RAW_SCHEMA_VERSION = 'val-match-v1';

export interface SyncSummary {
  fetched: number;
  skippedExisting: number;
  stored: number;
  excluded: number;
  failedNormalize: number;
  notFound: number;
  durationMs: number;
}

const MSG_DENIED = 'Riot denied access. Re-link your account.';
const MSG_BUSY = "Riot's API is busy or unavailable. Try again later.";

export function toPlayerRounds(match: NormalizedMatch, puuid: string): PlayerRoundRow[] {
  const player = match.participants.find((p) => p.puuid === puuid);
  return match.rounds.map((round) => {
    const first = round.kills[0];
    return {
      roundNumber: round.roundNumber,
      won: player !== undefined && round.winningTeam === player.teamId,
      result: round.result,
      kills: round.kills.filter((k) => k.killer === puuid).length,
      died: round.kills.some((k) => k.victim === puuid),
      damage: round.damage.find((d) => d.puuid === puuid)?.damage ?? 0,
      firstKill: first !== undefined && first.killer === puuid,
      firstDeath: first !== undefined && first.victim === puuid,
      planted: round.planter === puuid,
      defused: round.defuser === puuid,
    };
  });
}

class StopSync extends Error {
  constructor(
    readonly category: string,
    readonly userMessage: string,
  ) {
    super(category);
  }
}

export async function runSyncJob(deps: IngestionDeps, jobId: string, userId: string): Promise<SyncSummary> {
  const { db, riot } = deps;
  const now = deps.now ?? (() => new Date());
  const log = deps.log ?? (() => {});
  const retentionDays = deps.rawRetentionDays ?? 30;
  const limit = createLimiter(deps.concurrency ?? 4);
  const t0 = Date.now();
  const summary: SyncSummary = { fetched: 0, skippedExisting: 0, stored: 0, excluded: 0, failedNormalize: 0, notFound: 0, durationMs: 0 };
  const finish = (): SyncSummary => {
    summary.durationMs = Date.now() - t0;
    return summary;
  };

  const account = await getRiotAccount(db, userId);
  if (!account || account.linkState === 'unlinked' || account.linkState === 'consent_removed') {
    await updateJob(db, jobId, {
      state: 'failed',
      errorCategory: 'not_linked',
      errorMessage: 'No linked Riot account.',
      finishedAt: now(),
    });
    log('sync_not_linked', { jobId });
    return finish();
  }

  const puuid = account.puuid;
  const shard = account.shard as RiotShard;

  try {
    await updateJob(db, jobId, { state: 'running', startedAt: now() });
    await setLinkState(db, userId, 'syncing');

    const content = await riot.getContent(shard);
    await upsertContent(db, [
      ...content.characters.map((c) => ({ kind: 'agent' as const, id: c.id, name: c.name, assetPath: null })),
      ...content.maps.map((m) => ({ kind: 'map' as const, id: m.id, name: m.name, assetPath: m.assetPath ?? null })),
    ]);

    const matchlist = await riot.getMatchlist(puuid, shard);
    await saveRawPayload(db, {
      kind: 'matchlist',
      sourceKey: puuid,
      payload: matchlist,
      schemaVersion: RAW_SCHEMA_VERSION,
      retentionDays,
    });

    const seen = new Set<string>();
    const pending: string[] = [];
    for (const entry of matchlist.history ?? []) {
      const id = entry.matchId;
      if (seen.has(id)) continue;
      seen.add(id);
      if (await hasPlayerRecord(db, id, puuid)) summary.skippedExisting++;
      else pending.push(id);
    }
    await updateJob(db, jobId, { total: pending.length, cursor: 0 });

    let stop: StopSync | null = null;
    let done = 0;

    const processOne = async (matchId: string): Promise<void> => {
      if (stop) return;
      try {
        const raw = await riot.getMatch(matchId, shard);
        summary.fetched++;
        const rawId = await saveRawPayload(db, {
          kind: 'match',
          sourceKey: matchId,
          payload: raw,
          schemaVersion: RAW_SCHEMA_VERSION,
          retentionDays,
        });
        const result = normalizeMatch(raw);
        if (!result.ok) {
          summary.failedNormalize++;
          log('normalize_failed', { matchId, issues: result.issues.map((i) => i.code) });
          return;
        }
        const match = result.match;
        await upsertMatch(db, match, rawId);
        const record = toPlayerRecord(match, puuid);
        if (!record) {
          summary.failedNormalize++;
          log('normalize_failed', { matchId, issues: ['player_missing'] });
          return;
        }
        await upsertPlayerRecord(db, record, match.excluded);
        await replacePlayerRounds(db, matchId, puuid, toPlayerRounds(match, puuid));
        summary.stored++;
        if (match.excluded) summary.excluded++;
      } catch (err) {
        if (err instanceof RiotApiError) {
          if (err.category === 'not_found') {
            summary.notFound++;
            log('match_not_found', { matchId });
            return;
          }
          if (err.category === 'auth' || err.category === 'forbidden') {
            stop ??= new StopSync(err.category, MSG_DENIED);
            return;
          }
          stop ??= new StopSync(err.category, MSG_BUSY);
          return;
        }
        throw err;
      } finally {
        done++;
        await updateJob(db, jobId, { cursor: done });
      }
    };

    await Promise.all(pending.map((id) => limit(() => processOne(id))));

    if (stop) throw stop;

    await updateJob(db, jobId, { state: 'succeeded', finishedAt: now(), cursor: done });
    await setLinkState(db, userId, 'up_to_date', { lastSyncedAt: now(), lastError: null });
    await purgeExpiredRawPayloads(db, now());
    log('sync_succeeded', { jobId, ...summary });
  } catch (err) {
    if (err instanceof StopSync) {
      await updateJob(db, jobId, { state: 'failed', errorCategory: err.category, errorMessage: err.userMessage, finishedAt: now() });
      await setLinkState(db, userId, 'sync_failed', { lastError: err.userMessage });
      log('sync_failed', { jobId, category: err.category });
    } else if (err instanceof RiotApiError) {
      // Failure outside per-match processing (content / matchlist): same mapping.
      const denied = err.category === 'auth' || err.category === 'forbidden';
      const msg = denied ? MSG_DENIED : MSG_BUSY;
      await updateJob(db, jobId, { state: 'failed', errorCategory: err.category, errorMessage: msg, finishedAt: now() });
      await setLinkState(db, userId, 'sync_failed', { lastError: msg });
      log('sync_failed', { jobId, category: err.category });
    } else {
      const message = 'Sync failed unexpectedly. Try again later.';
      await updateJob(db, jobId, { state: 'failed', errorCategory: 'internal', errorMessage: message, finishedAt: now() });
      await setLinkState(db, userId, 'sync_failed', { lastError: message });
      log('sync_internal_error', { jobId, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return finish();
}

export class SyncQueue {
  private readonly pending: { jobId: string; userId: string }[] = [];
  private running = false;
  private idleWaiters: (() => void)[] = [];

  constructor(private readonly deps: IngestionDeps) {}

  async enqueue(userId: string): Promise<JobRow> {
    const job = await createOrGetActiveJob(this.deps.db, userId);
    const known = this.pending.some((p) => p.jobId === job.id) || this.current?.jobId === job.id;
    if (!known) {
      this.pending.push({ jobId: job.id, userId });
      void this.drain();
    }
    return job;
  }

  private current: { jobId: string; userId: string } | null = null;

  private async drain(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      let next: { jobId: string; userId: string } | undefined;
      while ((next = this.pending.shift())) {
        this.current = next;
        try {
          await runSyncJob(this.deps, next.jobId, next.userId);
        } catch (err) {
          this.deps.log?.('sync_queue_error', { jobId: next.jobId, error: err instanceof Error ? err.message : String(err) });
        }
        this.current = null;
      }
    } finally {
      this.running = false;
      const waiters = this.idleWaiters;
      this.idleWaiters = [];
      for (const w of waiters) w();
    }
  }

  idle(): Promise<void> {
    if (!this.running && this.pending.length === 0) return Promise.resolve();
    return new Promise((resolve) => this.idleWaiters.push(resolve));
  }

  startScheduler(intervalMs: number): () => void {
    const tick = async (): Promise<void> => {
      try {
        const accounts = await listLinkedAccounts(this.deps.db);
        for (const a of accounts) {
          if (a.linkState === 'syncing') continue;
          await this.enqueue(a.userId);
        }
      } catch (err) {
        this.deps.log?.('scheduler_error', { error: err instanceof Error ? err.message : String(err) });
      }
    };
    const handle = setInterval(() => void tick(), intervalMs);
    return () => clearInterval(handle);
  }
}
