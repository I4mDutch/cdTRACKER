import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  foreignKey,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import type { NormalizedTeam, ShareField } from './types.js';

const tstz = (name: string) => timestamp(name, { withTimezone: true });

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  displayName: text('display_name').notNull(),
  isDemo: boolean('is_demo').notNull().default(false),
  settings: jsonb('settings').$type<Record<string, unknown>>().notNull().default({}),
  createdAt: tstz('created_at').notNull().defaultNow(),
});

export const sessions = pgTable(
  'sessions',
  {
    tokenHash: text('token_hash').primaryKey(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    createdAt: tstz('created_at').notNull().defaultNow(),
    expiresAt: tstz('expires_at').notNull(),
  },
  (t) => [index('sessions_user_id_idx').on(t.userId)],
);

export const riotAccounts = pgTable('riot_accounts', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().unique().references(() => users.id, { onDelete: 'cascade' }),
  puuid: text('puuid').notNull().unique(),
  gameName: text('game_name'),
  tagLine: text('tag_line'),
  shard: text('shard').notNull(),
  linkState: text('link_state').notNull(),
  consentedAt: tstz('consented_at'),
  linkedAt: tstz('linked_at'),
  lastSyncedAt: tstz('last_synced_at'),
  lastError: text('last_error'),
});

export const oauthStates = pgTable('oauth_states', {
  state: text('state').primaryKey(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
  expiresAt: tstz('expires_at').notNull(),
});

export const contentItems = pgTable(
  'content_items',
  {
    kind: text('kind').notNull(),
    id: text('id').notNull(),
    name: text('name').notNull(),
    assetPath: text('asset_path'),
    updatedAt: tstz('updated_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.kind, t.id] })],
);

export const rawPayloads = pgTable(
  'raw_payloads',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    kind: text('kind').notNull(),
    sourceKey: text('source_key').notNull(),
    schemaVersion: text('schema_version').notNull(),
    payload: jsonb('payload').notNull(),
    fetchedAt: tstz('fetched_at').notNull().defaultNow(),
    expiresAt: tstz('expires_at').notNull(),
  },
  (t) => [index('raw_payloads_kind_source_idx').on(t.kind, t.sourceKey), index('raw_payloads_expires_idx').on(t.expiresAt)],
);

export const matches = pgTable(
  'matches',
  {
    matchId: text('match_id').primaryKey(),
    startedAt: tstz('started_at').notNull(),
    mapId: text('map_id').notNull(),
    queueId: text('queue_id').notNull(),
    patch: text('patch'),
    seasonId: text('season_id'),
    durationMs: integer('duration_ms'),
    roundsPlayed: integer('rounds_played').notNull(),
    isCompleted: boolean('is_completed').notNull(),
    excluded: text('excluded'),
    teams: jsonb('teams').$type<NormalizedTeam[]>().notNull(),
    hasRoundData: boolean('has_round_data').notNull(),
    rawPayloadId: uuid('raw_payload_id').references(() => rawPayloads.id, { onDelete: 'set null' }),
    fetchedAt: tstz('fetched_at').notNull().defaultNow(),
  },
  (t) => [index('matches_started_at_idx').on(t.startedAt)],
);

export const playerMatchRecords = pgTable(
  'player_match_records',
  {
    matchId: text('match_id').notNull().references(() => matches.matchId, { onDelete: 'cascade' }),
    puuid: text('puuid').notNull(),
    startedAt: tstz('started_at').notNull(),
    mapId: text('map_id').notNull(),
    queueId: text('queue_id').notNull(),
    patch: text('patch'),
    agentId: text('agent_id').notNull(),
    teamId: text('team_id').notNull(),
    outcome: text('outcome').notNull(),
    roundsPlayed: integer('rounds_played').notNull(),
    roundsWon: integer('rounds_won').notNull(),
    roundsLost: integer('rounds_lost').notNull(),
    kills: integer('kills').notNull(),
    deaths: integer('deaths').notNull(),
    assists: integer('assists').notNull(),
    combatScore: integer('combat_score'),
    damageDealt: integer('damage_dealt'),
    headshots: integer('headshots'),
    bodyshots: integer('bodyshots'),
    legshots: integer('legshots'),
    firstKills: integer('first_kills'),
    firstDeaths: integer('first_deaths'),
    plants: integer('plants'),
    defuses: integer('defuses'),
    performanceScore: integer('performance_score'),
    excluded: text('excluded'),
  },
  (t) => [
    primaryKey({ columns: [t.matchId, t.puuid] }),
    index('pmr_puuid_started_idx').on(t.puuid, t.startedAt),
    index('pmr_puuid_agent_idx').on(t.puuid, t.agentId),
    index('pmr_puuid_map_idx').on(t.puuid, t.mapId),
  ],
);

export const playerRounds = pgTable(
  'player_rounds',
  {
    matchId: text('match_id').notNull(),
    puuid: text('puuid').notNull(),
    roundNumber: integer('round_number').notNull(),
    won: boolean('won').notNull(),
    result: text('result').notNull(),
    kills: integer('kills').notNull(),
    died: boolean('died').notNull(),
    damage: integer('damage').notNull(),
    firstKill: boolean('first_kill').notNull(),
    firstDeath: boolean('first_death').notNull(),
    planted: boolean('planted').notNull(),
    defused: boolean('defused').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.matchId, t.puuid, t.roundNumber] }),
    foreignKey({
      columns: [t.matchId, t.puuid],
      foreignColumns: [playerMatchRecords.matchId, playerMatchRecords.puuid],
      name: 'player_rounds_record_fk',
    }).onDelete('cascade'),
  ],
);

export const ingestionJobs = pgTable(
  'ingestion_jobs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    state: text('state').notNull(),
    cursor: integer('cursor').notNull().default(0),
    total: integer('total'),
    retryCount: integer('retry_count').notNull().default(0),
    errorCategory: text('error_category'),
    errorMessage: text('error_message'),
    createdAt: tstz('created_at').notNull().defaultNow(),
    startedAt: tstz('started_at'),
    finishedAt: tstz('finished_at'),
  },
  (t) => [index('jobs_user_state_idx').on(t.userId, t.state)],
);

export const insightFeedback = pgTable(
  'insight_feedback',
  {
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    findingId: text('finding_id').notNull(),
    action: text('action').notNull(),
    createdAt: tstz('created_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.findingId] })],
);

export const shareLinks = pgTable('share_links', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  tokenHash: text('token_hash').notNull().unique(),
  fields: jsonb('fields').$type<ShareField[]>().notNull(),
  createdAt: tstz('created_at').notNull().defaultNow(),
  expiresAt: tstz('expires_at'),
  revokedAt: tstz('revoked_at'),
});

export const analysisSnapshots = pgTable(
  'analysis_snapshots',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    version: text('version').notNull(),
    filter: jsonb('filter').notNull(),
    result: jsonb('result').notNull(),
    createdAt: tstz('created_at').notNull().defaultNow(),
  },
  (t) => [index('snapshots_user_kind_created_idx').on(t.userId, t.kind, t.createdAt)],
);

export const manualMatches = pgTable(
  'manual_matches',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    startedAt: tstz('started_at').notNull(),
    mapId: text('map_id').notNull(),
    agentId: text('agent_id').notNull(),
    queueId: text('queue_id').notNull(),
    patch: text('patch'),
    roundsWon: integer('rounds_won').notNull(),
    roundsLost: integer('rounds_lost').notNull(),
    kills: integer('kills').notNull(),
    deaths: integer('deaths').notNull(),
    assists: integer('assists').notNull(),
    combatScore: integer('combat_score'),
    damageDealt: integer('damage_dealt'),
    firstKills: integer('first_kills'),
    firstDeaths: integer('first_deaths'),
    note: text('note'),
    excluded: text('excluded'),
    dedupeKey: text('dedupe_key').notNull(),
    createdAt: tstz('created_at').notNull().defaultNow(),
    updatedAt: tstz('updated_at').notNull().defaultNow(),
  },
  (t) => [
    index('manual_matches_user_started_idx').on(t.userId, t.startedAt),
    unique('manual_matches_user_dedupe_uq').on(t.userId, t.dedupeKey),
  ],
);
