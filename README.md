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
