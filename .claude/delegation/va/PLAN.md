# VALORANT Analyzer — delegation plan

## Goal
Implement plan.md Phases 2–5 (ingestion spike, aggregation engine, evidence-based analysis, frontend MVP)
running entirely on **synthetic fixtures and mock RSO**, behind interfaces a real Riot production client
can replace. Phase 1 (Riot registration, production key, RSO approval) is a business dependency outside code.

## Mode
DELEGATE-MULTI (user pre-authorized delegation). Opus wrote scaffold + all shared contracts; Sonnet executors
implement modules; Opus verifies and integrates.

## Architecture (decided — do not revisit)
npm workspaces monorepo, TypeScript strict, ESM, Node 22. Packages export TS source directly (no build step);
`tsx` runs the API, Vite builds the web app, Vitest tests everything.

```
packages/shared   @va/shared  Types only: Riot DTOs (riot.ts), domain model (domain.ts), HTTP DTOs (api.ts)
packages/core     @va/core    Pure functions, no IO: normalize, aggregate, analysis (+score), config.ts
apps/api          @va/api     Express 5 + zod + Drizzle ORM (Postgres). PGlite in tests. Riot client, ingestion, routes
apps/web          @va/web     React 19 + Vite 6 + react-router 7 + Chart.js 4 (react-chartjs-2)
fixtures/riot     Synthetic Riot-shaped payloads (no real players)
docs/field-matrix.md  Which fields are confirmed / must-verify / unavailable
```

Data flow: RiotClient → raw JSON stored (`raw_payloads`) → `normalizeMatch` → `matches`/`match_participants`/`match_rounds`
→ `toPlayerRecord` → `player_match_records` (one row per linked player per match) → core aggregate/analysis computed
on request from those records (data is small per user; no materialized aggregates in v1).

Key rules carried from plan.md:
- `null` = unavailable, never 0. Track coverage.
- Performance Score is unavailable in the documented API → always null; UI says so.
- Match detail exposes only the linked player's own stats + team results. No other players' names/stats anywhere.
- Insights carry metric, value, baseline, sample size, evidence level, hedged wording, method.
- Analyzer Score is relative to own history, versioned, component breakdown, coverage; never called rank/MMR.
- Only `competitive` queue is analyzed by default (config).
- Riot non-endorsement notice (`RIOT_NOTICE` in @va/shared) visible in the web footer.

## Shared contracts (written by Opus before dispatch — read-only for executors)
- `packages/shared/src/{riot,domain,api}.ts`
- `packages/core/src/config.ts` and the stub signatures in `packages/core/src/{normalize,aggregate,analysis}/index.ts`
- `apps/api/src/riot/types.ts` (RiotClient interface, RiotApiError)
- Dependencies are already installed. **Do not add dependencies.** If one is truly needed, report BLOCKED.

## Commands
- Typecheck one workspace: `npm run typecheck -w packages/core` (or `apps/api`, `apps/web`, `packages/shared`)
- Test one workspace: `npm test -w packages/core`
- Everything: `npm run typecheck && npm test`

## Task graph
| Wave | Task | Agent | Owns |
|---|---|---|---|
| 1 | T01 synthetic fixtures | sonnet | `scripts/generate-fixtures.ts`, `fixtures/**` |
| 1 | T02 normalize | sonnet | `packages/core/src/normalize/**`, `packages/core/test/normalize*` |
| 1 | T03 aggregate | sonnet | `packages/core/src/aggregate/**`, `packages/core/test/aggregate*` |
| 1 | T04 Riot clients | sonnet | `apps/api/src/riot/**` except `types.ts`, `apps/api/test/riot*` |
| 1 | T05 web app | sonnet | `apps/web/**` |
| 2 | T06 analysis + score | sonnet | `packages/core/src/analysis/**`, `packages/core/test/analysis*` |
| 2 | T07 DB schema + repos | sonnet | `apps/api/src/db/**`, `apps/api/drizzle/**`, `apps/api/drizzle.config.ts`, `apps/api/test/db*` |
| 3 | T08 ingestion/sync | sonnet | `apps/api/src/ingestion/**`, `apps/api/test/ingestion*` |
| 4 | T09 HTTP API + auth | sonnet | `apps/api/src/http/**`, `apps/api/src/main.ts`, `apps/api/src/app.ts`, `apps/api/src/env.ts`, `apps/api/test/http*`, `apps/api/.env.example` |
| — | Integration, review, README | opus | everything |

## Risks
- Web (T05) is built against DTOs before the API exists → mitigated by strict DTO contract in `@va/shared/api.ts`.
- Drizzle type differences between node-postgres and PGlite → T07 exports a driver-agnostic `Db` type.
- Fixture realism: T01 must keep team rounds, round winners and kill events mutually consistent.

## Log
- All 9 tasks ran on Sonnet; none blocked, none needed a retry or a tier escalation. Opus re-ran every acceptance command.
- T01: player 0002's 15 matches are a subset of 0001's (keeps the 69-file count); T09 authorization test adjusted.
- T05 → T09 contract gap: RSO had to double as sign-in for signed-out users. T07 was amended mid-run (nullable `oauth_states.user_id`), and the T09 spec was updated.
- T08 → T09: startup recovery for interrupted jobs added to the T09 spec.
- Integration (Opus): end-to-end run in Playwright (demo login → sync → every view). Fixed mobile overflow from the visually-hidden chart table. An independent Sonnet agent reviewed the security/privacy code.
- Final: 175 tests (core 87, api 74, web 14), typecheck and web build all green.

### Manual entry + CSV import (follow-up)
- Opus wrote the contracts (shared manual/import DTOs, `source` on records/filters, per-field coverage, `catalog` on filter options) and core `manualOutcome`/`manualExclusion`.
- T10 core, T11 DB (`manual_matches` + migration 0001), T13 web ran in parallel; T12 API ran after T10 and T11. All Sonnet, no blocks or retries.
- Integration (Opus): Playwright run covering add match → detail → CSV dry run with an invalid row → valid import → Overview "includes 3 manual entries" → Source filter. CSV row errors now use the file's column names and quote the bad map/agent value.
- Final: 261 tests (core 101, api 128, web 32), typecheck and build green.
