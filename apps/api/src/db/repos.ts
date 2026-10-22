import { createHash, randomBytes } from 'node:crypto';
import { and, asc, eq, gt, inArray, isNull, lt, notInArray, or, sql } from 'drizzle-orm';
import type { NameLookup } from '@va/core';
import type { Db } from './client.js';
import * as s from './schema.js';
import type { ExclusionReason, LinkState, NormalizedMatch, PlayerMatchRecord, ShareField } from './types.js';
import { recordDomainToRow, recordRowToDomain, roundRowToDomain, type PlayerRoundRow, type StoredPlayerRecord } from './mappers.js';

export type UserRow = typeof s.users.$inferSelect;
export type RiotAccountRow = typeof s.riotAccounts.$inferSelect;
export type JobRow = typeof s.ingestionJobs.$inferSelect;
export type ShareLinkRow = typeof s.shareLinks.$inferSelect;
export type MatchRow = typeof s.matches.$inferSelect;

const DAY_MS = 86_400_000;
const OAUTH_STATE_TTL_MS = 10 * 60_000;

export const sha256Hex = (v: string): string => createHash('sha256').update(v).digest('hex');
const newToken = (): string => randomBytes(32).toString('base64url');

// ---------- users & sessions ----------
export async function createUser(db: Db, input: { displayName: string; isDemo?: boolean }): Promise<UserRow> {
  const [row] = await db.insert(s.users).values({ displayName: input.displayName, isDemo: input.isDemo ?? false }).returning();
  return row!;
}

export async function getUser(db: Db, id: string): Promise<UserRow | null> {
  const [row] = await db.select().from(s.users).where(eq(s.users.id, id));
  return row ?? null;
}

export async function createSession(db: Db, userId: string, ttlMs: number): Promise<{ token: string; expiresAt: Date }> {
  const token = newToken();
  const expiresAt = new Date(Date.now() + ttlMs);
  await db.insert(s.sessions).values({ tokenHash: sha256Hex(token), userId, expiresAt });
  return { token, expiresAt };
}

export async function getSessionUser(db: Db, token: string): Promise<UserRow | null> {
  const rows = await db
    .select({ user: s.users })
    .from(s.sessions)
    .innerJoin(s.users, eq(s.users.id, s.sessions.userId))
    .where(and(eq(s.sessions.tokenHash, sha256Hex(token)), gt(s.sessions.expiresAt, new Date())));
  return rows[0]?.user ?? null;
}

export async function deleteSession(db: Db, token: string): Promise<void> {
  await db.delete(s.sessions).where(eq(s.sessions.tokenHash, sha256Hex(token)));
}

// ---------- riot account ----------
export async function getRiotAccount(db: Db, userId: string): Promise<RiotAccountRow | null> {
  const [row] = await db.select().from(s.riotAccounts).where(eq(s.riotAccounts.userId, userId));
  return row ?? null;
}

export async function getRiotAccountByPuuid(db: Db, puuid: string): Promise<RiotAccountRow | null> {
  const [row] = await db.select().from(s.riotAccounts).where(eq(s.riotAccounts.puuid, puuid));
  return row ?? null;
}

export async function upsertRiotAccount(
  db: Db,
  input: { userId: string; puuid: string; gameName: string | null; tagLine: string | null; shard: string; consentedAt: Date },
): Promise<RiotAccountRow> {
  const now = new Date();
  const values = {
    puuid: input.puuid,
    gameName: input.gameName,
    tagLine: input.tagLine,
    shard: input.shard,
    linkState: 'linked',
    consentedAt: input.consentedAt,
    linkedAt: now,
    lastError: null,
  };
  const [row] = await db
    .insert(s.riotAccounts)
    .values({ userId: input.userId, ...values })
    .onConflictDoUpdate({ target: s.riotAccounts.userId, set: values })
    .returning();
  return row!;
}

export async function setLinkState(
  db: Db,
  userId: string,
  state: LinkState,
  extra?: { lastError?: string | null; lastSyncedAt?: Date },
): Promise<void> {
  const set: Partial<typeof s.riotAccounts.$inferInsert> = { linkState: state };
  if (extra && 'lastError' in extra) set.lastError = extra.lastError ?? null;
  if (extra?.lastSyncedAt) set.lastSyncedAt = extra.lastSyncedAt;
  await db.update(s.riotAccounts).set(set).where(eq(s.riotAccounts.userId, userId));
}

export async function listLinkedAccounts(db: Db): Promise<RiotAccountRow[]> {
  return db.select().from(s.riotAccounts).where(notInArray(s.riotAccounts.linkState, ['unlinked', 'consent_removed']));
}

// ---------- oauth state ----------
export async function createOAuthState(db: Db, userId: string | null): Promise<string> {
  const state = newToken();
  await db.delete(s.oauthStates).where(lt(s.oauthStates.expiresAt, new Date()));
  await db.insert(s.oauthStates).values({ state, userId, expiresAt: new Date(Date.now() + OAUTH_STATE_TTL_MS) });
  return state;
}

export async function consumeOAuthState(db: Db, state: string): Promise<{ userId: string | null } | null> {
  const [row] = await db.delete(s.oauthStates).where(eq(s.oauthStates.state, state)).returning();
  if (!row || row.expiresAt.getTime() <= Date.now()) return null;
  return { userId: row.userId };
}

// ---------- content ----------
export async function upsertContent(
  db: Db,
  items: { kind: 'agent' | 'map'; id: string; name: string; assetPath: string | null }[],
): Promise<void> {
  if (items.length === 0) return;
  await db
    .insert(s.contentItems)
    .values(items.map((i) => ({ kind: i.kind, id: i.id, name: i.name, assetPath: i.assetPath })))
    .onConflictDoUpdate({
      target: [s.contentItems.kind, s.contentItems.id],
      set: { name: sql`excluded.name`, assetPath: sql`excluded.asset_path`, updatedAt: new Date() },
    });
}

export async function getNameLookup(db: Db): Promise<NameLookup> {
  const rows = await db.select().from(s.contentItems);
  const lookup: NameLookup = { agents: {}, maps: {} };
  for (const r of rows) {
    if (r.kind === 'agent') lookup.agents[r.id] = r.name;
    else if (r.kind === 'map') lookup.maps[r.assetPath ?? r.id] = r.name;
  }
  return lookup;
}

// ---------- raw payloads ----------
export async function saveRawPayload(
  db: Db,
  input: { kind: 'match' | 'matchlist'; sourceKey: string; payload: unknown; schemaVersion: string; retentionDays: number },
): Promise<string> {
  const now = Date.now();
  const [row] = await db
    .insert(s.rawPayloads)
    .values({
      kind: input.kind,
      sourceKey: input.sourceKey,
      schemaVersion: input.schemaVersion,
      payload: input.payload,
      fetchedAt: new Date(now),
      expiresAt: new Date(now + input.retentionDays * DAY_MS),
    })
    .returning({ id: s.rawPayloads.id });
  return row!.id;
}

export async function purgeExpiredRawPayloads(db: Db, now: Date = new Date()): Promise<number> {
  const rows = await db.delete(s.rawPayloads).where(lt(s.rawPayloads.expiresAt, now)).returning({ id: s.rawPayloads.id });
  return rows.length;
}

// ---------- matches & records ----------
export async function upsertMatch(db: Db, match: NormalizedMatch, rawPayloadId: string | null): Promise<void> {
  const values = {
    startedAt: new Date(match.startedAt),
    mapId: match.mapId,
    queueId: match.queueId,
    patch: match.patch,
    seasonId: match.seasonId,
    durationMs: match.durationMs,
    roundsPlayed: match.roundsPlayed,
    isCompleted: match.isCompleted,
    excluded: match.excluded,
    teams: match.teams,
    hasRoundData: match.rounds.length > 0,
    rawPayloadId,
    fetchedAt: new Date(),
  };
  await db
    .insert(s.matches)
    .values({ matchId: match.matchId, ...values })
    .onConflictDoUpdate({ target: s.matches.matchId, set: values });
}

export async function hasPlayerRecord(db: Db, matchId: string, puuid: string): Promise<boolean> {
  const rows = await db
    .select({ m: s.playerMatchRecords.matchId })
    .from(s.playerMatchRecords)
    .where(and(eq(s.playerMatchRecords.matchId, matchId), eq(s.playerMatchRecords.puuid, puuid)))
    .limit(1);
  return rows.length > 0;
}

export async function upsertPlayerRecord(db: Db, record: PlayerMatchRecord, excluded: ExclusionReason | null): Promise<void> {
  const row = recordDomainToRow(record, excluded);
  const { matchId: _m, puuid: _p, ...set } = row;
  await db
    .insert(s.playerMatchRecords)
    .values(row)
    .onConflictDoUpdate({ target: [s.playerMatchRecords.matchId, s.playerMatchRecords.puuid], set });
}

export async function replacePlayerRounds(db: Db, matchId: string, puuid: string, rounds: PlayerRoundRow[]): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.delete(s.playerRounds).where(and(eq(s.playerRounds.matchId, matchId), eq(s.playerRounds.puuid, puuid)));
    if (rounds.length > 0) {
      await tx.insert(s.playerRounds).values(rounds.map((r) => ({ matchId, puuid, ...r })));
    }
  });
}

export async function listPlayerRecords(
  db: Db,
  puuid: string,
  opts?: { includeExcluded?: boolean },
): Promise<StoredPlayerRecord[]> {
  const where = opts?.includeExcluded
    ? eq(s.playerMatchRecords.puuid, puuid)
    : and(eq(s.playerMatchRecords.puuid, puuid), isNull(s.playerMatchRecords.excluded));
  const rows = await db
    .select()
    .from(s.playerMatchRecords)
    .where(where)
    .orderBy(asc(s.playerMatchRecords.startedAt), asc(s.playerMatchRecords.matchId));
  return rows.map(recordRowToDomain);
}

export async function getPlayerMatch(
  db: Db,
  matchId: string,
  puuid: string,
): Promise<{ match: MatchRow; record: StoredPlayerRecord; rounds: PlayerRoundRow[] } | null> {
  const [rec] = await db
    .select()
    .from(s.playerMatchRecords)
    .where(and(eq(s.playerMatchRecords.matchId, matchId), eq(s.playerMatchRecords.puuid, puuid)));
  if (!rec) return null;
  const [match] = await db.select().from(s.matches).where(eq(s.matches.matchId, matchId));
  if (!match) return null;
  const rounds = await db
    .select()
    .from(s.playerRounds)
    .where(and(eq(s.playerRounds.matchId, matchId), eq(s.playerRounds.puuid, puuid)))
    .orderBy(asc(s.playerRounds.roundNumber));
  return { match, record: recordRowToDomain(rec), rounds: rounds.map(roundRowToDomain) };
}

export async function deleteUserMatchData(db: Db, userId: string): Promise<void> {
  await db.transaction(async (tx) => {
    const [account] = await tx.select().from(s.riotAccounts).where(eq(s.riotAccounts.userId, userId));
    if (account) {
      const puuid = account.puuid;
      const mine = await tx
        .select({ matchId: s.playerMatchRecords.matchId })
        .from(s.playerMatchRecords)
        .where(eq(s.playerMatchRecords.puuid, puuid));
      const matchIds = mine.map((r) => r.matchId);

      await tx.delete(s.playerRounds).where(eq(s.playerRounds.puuid, puuid));
      await tx.delete(s.playerMatchRecords).where(eq(s.playerMatchRecords.puuid, puuid));

      if (matchIds.length > 0) {
        const stillUsed = await tx
          .select({ matchId: s.playerMatchRecords.matchId })
          .from(s.playerMatchRecords)
          .where(inArray(s.playerMatchRecords.matchId, matchIds));
        const used = new Set(stillUsed.map((r) => r.matchId));
        const orphans = matchIds.filter((id) => !used.has(id));
        if (orphans.length > 0) {
          const orphanRows = await tx
            .select({ raw: s.matches.rawPayloadId })
            .from(s.matches)
            .where(inArray(s.matches.matchId, orphans));
          const rawIds = orphanRows.map((r) => r.raw).filter((x): x is string => x !== null);
          await tx.delete(s.matches).where(inArray(s.matches.matchId, orphans));
          if (rawIds.length > 0) await tx.delete(s.rawPayloads).where(inArray(s.rawPayloads.id, rawIds));
          await tx
            .delete(s.rawPayloads)
            .where(and(eq(s.rawPayloads.kind, 'match'), inArray(s.rawPayloads.sourceKey, orphans)));
        }
      }
      await tx.delete(s.rawPayloads).where(and(eq(s.rawPayloads.kind, 'matchlist'), eq(s.rawPayloads.sourceKey, puuid)));
    }
    await tx.delete(s.insightFeedback).where(eq(s.insightFeedback.userId, userId));
    await tx.delete(s.shareLinks).where(eq(s.shareLinks.userId, userId));
    await tx.delete(s.analysisSnapshots).where(eq(s.analysisSnapshots.userId, userId));
    await tx.delete(s.ingestionJobs).where(eq(s.ingestionJobs.userId, userId));
    await tx.delete(s.riotAccounts).where(eq(s.riotAccounts.userId, userId));
  });
}

// ---------- jobs ----------
export async function createOrGetActiveJob(db: Db, userId: string): Promise<JobRow> {
  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(s.ingestionJobs)
      .where(and(eq(s.ingestionJobs.userId, userId), inArray(s.ingestionJobs.state, ['queued', 'running'])))
      .orderBy(asc(s.ingestionJobs.createdAt))
      .limit(1);
    if (existing) return existing;
    const [row] = await tx.insert(s.ingestionJobs).values({ userId, state: 'queued' }).returning();
    return row!;
  });
}

export async function getJob(db: Db, id: string, userId: string): Promise<JobRow | null> {
  const [row] = await db
    .select()
    .from(s.ingestionJobs)
    .where(and(eq(s.ingestionJobs.id, id), eq(s.ingestionJobs.userId, userId)));
  return row ?? null;
}

export async function listQueuedJobs(db: Db): Promise<JobRow[]> {
  return db.select().from(s.ingestionJobs).where(eq(s.ingestionJobs.state, 'queued')).orderBy(asc(s.ingestionJobs.createdAt));
}

export async function updateJob(
  db: Db,
  id: string,
  patch: Partial<Pick<JobRow, 'state' | 'cursor' | 'total' | 'retryCount' | 'errorCategory' | 'errorMessage' | 'startedAt' | 'finishedAt'>>,
): Promise<void> {
  if (Object.keys(patch).length === 0) return;
  await db.update(s.ingestionJobs).set(patch).where(eq(s.ingestionJobs.id, id));
}

// ---------- feedback ----------
export async function saveFeedback(db: Db, userId: string, findingId: string, action: string): Promise<void> {
  await db
    .insert(s.insightFeedback)
    .values({ userId, findingId, action })
    .onConflictDoUpdate({ target: [s.insightFeedback.userId, s.insightFeedback.findingId], set: { action, createdAt: new Date() } });
}

export async function listFeedback(db: Db, userId: string): Promise<{ findingId: string; action: string }[]> {
  return db
    .select({ findingId: s.insightFeedback.findingId, action: s.insightFeedback.action })
    .from(s.insightFeedback)
    .where(eq(s.insightFeedback.userId, userId));
}

// ---------- share links ----------
export async function createShareLink(
  db: Db,
  userId: string,
  fields: ShareField[],
  expiresAt: Date | null,
): Promise<{ row: ShareLinkRow; token: string }> {
  const token = newToken();
  const [row] = await db.insert(s.shareLinks).values({ userId, tokenHash: sha256Hex(token), fields, expiresAt }).returning();
  return { row: row!, token };
}

export async function listShareLinks(db: Db, userId: string): Promise<ShareLinkRow[]> {
  return db.select().from(s.shareLinks).where(eq(s.shareLinks.userId, userId)).orderBy(asc(s.shareLinks.createdAt));
}

export async function revokeShareLink(db: Db, userId: string, id: string): Promise<boolean> {
  const rows = await db
    .update(s.shareLinks)
    .set({ revokedAt: new Date() })
    .where(and(eq(s.shareLinks.id, id), eq(s.shareLinks.userId, userId)))
    .returning({ id: s.shareLinks.id });
  return rows.length > 0;
}

export async function resolveShareToken(
  db: Db,
  token: string,
  now: Date = new Date(),
): Promise<{ userId: string; fields: ShareField[] } | null> {
  const [row] = await db
    .select()
    .from(s.shareLinks)
    .where(
      and(
        eq(s.shareLinks.tokenHash, sha256Hex(token)),
        isNull(s.shareLinks.revokedAt),
        or(isNull(s.shareLinks.expiresAt), gt(s.shareLinks.expiresAt, now)),
      ),
    );
  return row ? { userId: row.userId, fields: row.fields } : null;
}

// ---------- snapshots ----------
export async function saveSnapshot(
  db: Db,
  userId: string,
  kind: 'insights' | 'score',
  version: string,
  filter: unknown,
  result: unknown,
): Promise<void> {
  await db.insert(s.analysisSnapshots).values({ userId, kind, version, filter, result });
}
