# VALORANT Analyzer

Retrospective VALORANT performance analysis: match history by agent, map, queue and patch, evidence-backed
practice insights, and an optional, transparent Analyzer Score. See [`plan.md`](plan.md) for the product plan.

> **Status:** Phases 2–5 of the plan, running on **synthetic fixtures and mock Riot Sign On**. Live data needs
> Phase 1 first: product registration with Riot, an approved production API key, and RSO access. Until then the
> HTTP Riot client and the real RSO provider exist but haven't been run against Riot.

## Quick start (no setup)

```bash
npm install
npm run dev:api     # http://localhost:3000 — in-memory PGlite + fixtures, demo mode
npm run dev:web     # http://localhost:5173 — click "Try demo"
```

## Manual entry and CSV import

You don't need a linked Riot account to add matches yourself:

- **Matches → Add match** (`/matches/new`): map, agent, queue, date, score, K/D/A, plus optional ACS, ADR, first kills/deaths and a note. Blank optional fields count as *unavailable*, not zero.
- **Import** (`/import`): download the template, fill it in, and upload it. You get a preview showing every row as Valid, Invalid or Duplicate before anything is saved. Imports are all-or-nothing: one invalid row blocks the whole file. Rows identical to something already saved are skipped. Limits are 1000 rows and 1 MB per file.
- Manual entries are labelled "Manual" everywhere. The detail page says "Manual entry — entered by you, not from Riot". Every summary says "includes N manual entries". The filter bar has a **Source** filter (All / Riot only / Manual only).
- Manual entries have no round-level data, so first-duel insights and the score's objective component use only the matches that have that data.
- You can edit or delete entries individually, or delete them all from Settings. Unlinking Riot keeps your manual entries.

## Layout

| Path | What |
|---|---|
| `packages/shared` | Types only: Riot DTO subset, domain model, HTTP DTOs + route table (`api.ts`) |
| `packages/core` | Pure logic: normalize Riot payloads, aggregates/trends, findings, Analyzer Score, versioned config |
| `apps/api` | Express 5 API, Drizzle/Postgres (PGlite in tests/demo), Riot clients, ingestion/sync queue, RSO |
| `apps/web` | React 19 + Vite SPA (Overview, Agents, Maps, Insights, Matches, Settings, public share page) |
| `fixtures/riot` | Deterministic synthetic payloads (`npm run fixtures`); see `fixtures/README.md` |
| `docs/field-matrix.md` | Which Riot fields are confirmed, must be verified, or unavailable |

## Commands

```bash
npm run typecheck   # all workspaces
npm test            # all workspaces (core, api, web)
npm run build -w apps/web
npm run db:generate -w apps/api   # regenerate SQL migrations after schema changes
```

## Configuration

Copy `apps/api/.env.example` to `.env`. With no `RIOT_API_KEY` the API runs in demo mode (fixtures and mock RSO).
Set `DATABASE_URL` to use a real Postgres; otherwise it uses PGlite (`PGLITE_DIR` for on-disk, else in-memory).

## Guarantees enforced in code

- Only the linked player's own data is stored relationally. Raw payloads (which contain other players) expire after `RAW_RETENTION_DAYS`.
- No endpoint returns other participants' identities or stats. Authorization uses the session user's own PUUID; no route takes a PUUID.
- Riot Performance Score isn't in the documented match API, so it's always `null` and the UI says so. There's no "Map Rating".
- Each insight shows its metric, value, baseline, sample size, evidence level and method, worded as a pattern rather than a cause.
- The Analyzer Score is versioned, measured relative to the player's own history, and shown with component weights and coverage. It's never presented as a rank or MMR.
- Session and share tokens are stored only as SHA-256 hashes. RSO access tokens are used during the callback and never stored.

Before live use, re-check Riot's current policies, verify `docs/field-matrix.md` against approved responses, and complete the security review and retention policy listed in plan.md Phases 6–7.
