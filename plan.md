# VALORANT Analyzer — Project Plan

## 1. Overview

Build a web app with the approachable match-stat browsing of a VALORANT tracker and a stronger focus on retrospective performance analysis. The app imports a player's authorized match history, summarizes performance by agent, map, mode, and time period, and turns the available data into transparent, evidence-based practice recommendations.

**Core principle:** explain what the data supports; do not invent stats or present guesses as facts. The app is a reflection and coaching tool, not a live-match assistant or replacement for VALORANT's official ranked ladder.

## 2. Product and API Constraints — Resolve Before Building Around Live Data

- **Register the product with Riot.** Riot says VALORANT products serving players must be registered, including products that do not use documented APIs.
- **Plan for production API access and Riot Sign On (RSO).** VALORANT stat and training apps require player opt-in through RSO. Riot's current VALORANT policy says personal-key applications are not supported and RSO is available to developers with production-level API keys. Treat key approval and RSO access as an early project dependency, not a last-minute deployment task.
- **Respect opt-in and privacy.** Only show individual match data for players who have authorized sharing through the product. Do not expose a linked player's stats through public profiles or exports for non-consenting players. Do not analyze players the game deliberately hides.
- **Keep analysis retrospective.** Recommendations should help a player reflect after a match. Do not build live overlays or immediate tactical callouts that influence decisions during a match, or opponent scouting for upcoming matches.
- **Do not make an official-rank substitute.** The custom score must be clearly labeled as an Analyzer metric, explain its components, and never be marketed as Riot MMR, ELO, a rank predictor, or an official VALORANT rating.
- **Do not assume every desired statistic is available.** Riot documents VALORANT match, match-list, content, ranked leaderboard, and status endpoints, but every field needed by this product must be verified against the approved API response before the UI promises it.
- **Performance Score is optional until verified.** Riot documents Performance Score as a 0–500 in-game metric for Competitive, Unrated, Swiftplay, and Premier, visible in the MVP/post-match experience. The API plan must confirm that the approved match endpoint actually returns it. If it does not, store it as unavailable and use only documented fields for alternative analysis; do not scrape game memory or rely on unsupported endpoints.
- **Map Rating is not a defined Riot field in this plan.** Treat it as a custom **Map Impact Score** with a published formula, or omit it until it can be computed from available data. Never label a custom calculation as an official Riot rating.
- Follow Riot's current Developer API and Game Policies, terms, rate limits, branding rules, and legal boilerplate. Re-check policy before beta and public release.

## 3. Core Features

### A. Account Linking and Match Data Ingestion

- RSO login and explicit consent to link a Riot account and share match data.
- Resolve the authorized account to a PUUID using the supported account endpoint.
- Retrieve match IDs from the approved VALORANT match-list endpoint, then retrieve individual match details.
- Start with Competitive as the primary queue; make queue/mode support configurable and include other modes only when the API and analysis rules support them.
- Normalize supported fields such as match ID, start time, queue, map, patch/version where available, agent, player/team identifiers, kills, deaths, assists, round results, and any additional fields confirmed in the API schema.
- Save source JSON for debugging/reprocessing with controlled retention, then normalize it into relational tables.
- Provide manual refresh and incremental background sync. Respect rate limits, cache responses, back off on errors, and make jobs retry-safe.
- Maintain clear states for linked, syncing, up to date, consent removed, and sync failed.

### B. Aggregated Statistics

- Total matches and win/loss record.
- Overall win rate with match count and sample-size context.
- Kills, deaths, assists, K/D ratio, and per-round or per-match rates where the source data permits.
- Games played, win rate, K/D, KDA, and other supported stats per agent.
- Performance summaries per map, queue, patch, and date range.
- Trend lines for key metrics over time, including filters for agent, map, queue, patch, and recent-match window.
- Clear definitions and tooltips for all derived metrics. Handle zero deaths, missing fields, draws, remakes, and incomplete match payloads explicitly.

### C. Weakness and Improvement Analysis

- Find agents with reliably below-baseline win rates, not just low win rates from one or two matches.
- Find maps where a player's results or per-round metrics trail their own baseline or a valid, well-defined comparison baseline.
- Detect patterns such as high deaths per round, low assist contribution, weak first-duel outcomes, or low clutch conversion **only when the necessary source fields and adequate sample sizes exist**.
- Each insight includes: the metric, the value, the comparison baseline, the number of matches/rounds, the confidence or evidence level, and a practice suggestion.
- Use language such as “possible focus” or “worth reviewing” for low-confidence findings; do not claim to detect causes the data cannot observe.
- Do not infer positioning, crosshair placement, decision-making, or “poor post-plant positioning” from aggregate K/D alone. Only show such a tag if supported by relevant event data or a separately provided review workflow.
- Provide a dismissal/feedback option so players can flag insights that are not useful.

### D. Analyzer Score

Create an optional, transparent **Analyzer Score** (0–100) only after data fields and scaling are validated. It is a personal performance summary, not a skill rank.

- Normalize each component to a comparable 0–100 scale before applying weights. Never directly combine raw win-rate fractions, K/D ratios, and unrelated rating scales.
- Candidate components: match outcome, K/D or per-round combat stats, official Performance Score per round if exposed by the approved API, and objective/support contributions if those fields are available.
- Initial example weights, configurable and versioned: 30% outcome, 25% combat efficiency, 25% per-round impact, 20% objective/support contribution. Revisit weights with test data; omit unavailable components and re-normalize remaining weights while clearly reporting reduced coverage.
- Calculate a separate **Map Impact Score** only if it can be defined with sufficient data and compared fairly. Do not automatically mix a map-specific score into the overall score.
- Store the formula version with each result. Show component breakdowns, source-field coverage, sample size, and a tooltip explaining what changed the score.
- Avoid comparing players across accounts unless a valid, documented, and permitted baseline exists. If normalized against the same player's history, label it as relative to that history.

### E. Dashboard, Export, and Sharing

- Download a CSV of the linked player's own authorized data and aggregates.
- Optional public profile with a concise stats card, privacy controls, revocable share link, and clear opt-in. Public profiles must not reveal non-consenting players' details or hidden identities.
- Share card should display the date range and match count so a small sample is not mistaken for a stable trend.
- Add account unlinking and a process to delete or de-identify stored personal data according to the app's published retention policy.

## 4. UI Plan

### Home / Overview

- Summary cards: matches analyzed, win rate, K/D, latest trend, and Analyzer Score only when available.
- “Key findings” panel with no more than a few prioritized insights.
- Recent matches table with map, agent, result, and supported match-level stats.

### Agents

- Sortable agent table with games played, win rate, K/D, sample-size indication, and change vs. the player's baseline.
- Expand an agent to view trends and recent match breakdowns.
- Flag low-sample agents instead of presenting unstable values as definitive.

### Maps

- Map-by-metric matrix or heatmap for win rate and supported performance measures.
- Show the number of matches per map and allow filtering by agent, queue, patch, and time range.
- Label any custom Map Impact Score with its definition and formula version.

### Insights

- Prioritized practice recommendations with evidence, sample size, and an explanation of how each was generated.
- Link each insight to the matches or rounds that contributed to it when those references are available.
- Avoid generic or unsupported claims such as “bad positioning” without supporting data.

### Match Detail

- Per-match summary and available round-level/event details.
- Clearly distinguish Riot-provided fields from app-calculated metrics.
- If no useful round timeline is available through the approved API, do not fabricate one; show the match summary only.

### Account and Settings

- RSO link state, consent, refresh status, privacy controls, account unlinking, data deletion request, and CSV export.
- Toggles for default filters, date range, and optional analytics.

## 5. Data Flow

1. **Consent and authentication:** the player signs in through Riot Sign On and explicitly opts into data sharing.
2. **Account resolution:** retrieve the authorized account identifier using the supported Riot endpoint.
3. **Fetch:** retrieve match-list IDs and fetch supported match details through the approved API.
4. **Cache and validate:** store raw responses with retrieval timestamps and schema/source version; detect missing or changed fields.
5. **Normalize:** convert source payloads into internal match, participant, team, agent, map, round, and statistic records where available.
6. **Deduplicate:** use stable match IDs and upserts so retries cannot create duplicate matches or stats.
7. **Aggregate:** calculate materialized summaries and trend series.
8. **Analyze:** generate versioned insight findings and optional Analyzer Score components.
9. **Serve:** expose authorized, paginated JSON endpoints to the React frontend.
10. **Refresh:** run controlled incremental sync jobs and recompute only affected aggregates where possible.

## 6. Suggested Database Schema

Use PostgreSQL. Adjust tables to the verified API schema; do not create fake columns for data that the API does not expose.

- `users` — internal app user, account state, consent timestamps, privacy settings.
- `riot_accounts` — user ID, PUUID, region/routing cluster, linked/unlinked timestamps, RSO identifier references. Never store Riot passwords or OAuth secrets in this table.
- `matches` — match ID, start time, map ID, queue/mode, patch/version, duration, source timestamps, raw payload reference.
- `match_participants` — match ID, PUUID, team ID, agent ID, kills, deaths, assists, and other confirmed participant fields.
- `match_rounds` — match ID, round number, team results and event fields only if supplied by the approved source.
- `agents` — stable agent identifiers, localized names, icon/content metadata where permitted.
- `maps` — stable map identifiers, names, content metadata where permitted.
- `aggregates` — user/filters/time window, metric values, match count, calculated timestamp.
- `analysis_runs` — user ID, date range, configuration and formula versions, run status.
- `weakness_findings` — finding type, metric, observed value, baseline, sample size, evidence level, recommendation, generated timestamp.
- `score_components` — score/version and component values, weights, normalization metadata, and missing-component notes.
- `share_links` — user ID, revocable token hash, selected profile fields, visibility state, expiry if applicable.
- `ingestion_jobs` — job state, cursor/checkpoint, retry count, error category, timestamps.

Add foreign keys, indexes on user/match/time/agent/map, unique constraints on Riot match ID and participant identity per match, and appropriate delete/anonymization behavior. Keep OAuth tokens and API secrets in a dedicated secret store, not ordinary application tables.

## 7. Analysis Rules and Pseudocode

```text
for each user and selected filter window:
    matches = load authorized, normalized matches
    overallBaseline = compute_baseline(matches)

    for each agent in matches:
        sample = matches played with agent
        games = count(sample)
        wins = count_wins(sample)
        winRate = wins / games, when games > 0
        kd = sum(kills) / sum(deaths), with explicit zero-death handling
        perRoundRates = calculate_from_valid_round_counts(sample)
        confidence = estimate_sample_reliability(games, rounds)

        if sample is large enough and evidence is adequate:
            findings += compare_against_baseline(agent, sample, overallBaseline)

    for each map in matches:
        sample = matches played on map
        mapMetrics = compute_supported_metrics(sample)
        if sample is large enough:
            findings += compare_against_baseline(map, mapMetrics, overallBaseline)

    score = calculate_normalized_score(
        available_components,
        configured_weights,
        formula_version
    )

    save aggregates, evidence-backed findings, and score metadata
```

### Analysis requirements

- Thresholds and minimum sample sizes live in configuration, with documented defaults and tests.
- Prefer per-round rates when match lengths vary; keep total counts for context.
- Use smoothed rates or confidence intervals where useful so tiny samples do not produce extreme findings.
- Compare like with like where possible: same queue/mode, compatible patch window, or the player's own baseline.
- Do not interpret correlation as causation. Phrase outputs as patterns to review, not certainty about why a match was lost.
- Build unit tests for zero deaths, zero games, missing score fields, partial matches, ties/draws, remakes, duplicated API responses, and inconsistent team data.

## 8. API and Backend Design

**Stack:** Node.js + TypeScript + Express (or a comparable typed Node framework), PostgreSQL, and a migration tool such as Prisma or Drizzle.

Suggested internal routes:

- `GET /api/me` — current app user and link state.
- `POST /api/riot/connect` and `GET /api/riot/callback` — RSO flow endpoints.
- `POST /api/sync` — request an authorized, rate-limit-aware sync.
- `GET /api/matches` — paginated, filtered match summaries.
- `GET /api/matches/:matchId` — authorized match detail.
- `GET /api/summary` — aggregate statistics and trend series.
- `GET /api/agents` and `GET /api/maps` — aggregate breakdowns.
- `GET /api/insights` — evidence-backed findings.
- `GET /api/score` — score, components, version, and coverage status.
- `GET /api/export.csv` — export the current user's authorized records.
- `POST /api/share-links` / `DELETE /api/share-links/:id` — create or revoke profile sharing.
- `DELETE /api/account-link` — unlink account and begin applicable data deletion.

Security and reliability:

- Keep Riot API keys, RSO secrets, and session secrets in environment-backed secret management; never ship them to React.
- Use HTTPS, secure HTTP-only cookies or an equivalent secure session strategy, CSRF protection where applicable, rate limits, schema validation, and output encoding.
- Enforce authorization at the service/query layer, not just in the frontend.
- Handle `401`, `403`, `404`, `429`, and `5xx` responses with safe user messaging, retry/backoff where appropriate, and structured logs without tokens or unnecessary personal data.
- Use request timeouts, bounded concurrency, cache TTLs, and background queues for longer ingestion jobs.

## 9. Frontend and Visualization

**Stack:** React + TypeScript, a charting library such as Chart.js, and a lightweight component system with accessible keyboard and screen-reader support.

- Responsive desktop-first dashboard with a usable mobile layout.
- Charts need clear labels, time windows, hover details, and empty/error/loading states.
- Never use color alone to communicate win/loss or weak/strong states.
- Keep tables sortable and filterable; support accessible alternatives to heatmaps and other visual summaries.
- Use original product branding and layouts. Do not imply affiliation with Riot Games or copy another tracker’s exact visual identity.
- Include the Riot-required non-endorsement notice in a readily visible location, following the current policy wording.

## 10. Testing and Acceptance Criteria

- API contract tests confirm which fields actually arrive from the approved VALORANT endpoints.
- RSO consent and callback flow is tested, including cancellation, expiry, unlinking, and revoked access.
- An account cannot view or export another user's private match data.
- Sync is idempotent and recovers from rate limiting, network failures, and partial API responses.
- Aggregate calculations match a curated set of hand-checked test fixtures.
- Every insight exposes its source metric, baseline, sample size, and evidence level.
- No UI implies Performance Score or Map Impact Score exists when its source data is unavailable.
- CSV export contains only the selected user's authorized records and includes column definitions where practical.
- Share links can be revoked and do not expose hidden or non-consenting player details.
- Automated tests cover scoring formulas, threshold logic, database access controls, and data deletion behavior.

## 11. Milestones

| Phase | Target | Deliverable / Exit Criteria |
|---|---|---|
| 1. Feasibility and Riot registration | Week 1 | Product registered; policy checklist complete; production-key/RSO request started; API field matrix lists confirmed, optional, and unavailable fields. |
| 2. Backend and ingestion spike | Weeks 2–3 | RSO prototype or mock-auth flow; API client, raw fixture storage, retry/backoff, normalized match schema, and verified sample payloads. Use fixtures while production access is pending. |
| 3. Aggregation engine | Weeks 4–5 | Correct overall, agent, and map aggregates; filters; edge-case tests; basic trends. |
| 4. Evidence-based analysis | Weeks 6–7 | Sample-size-aware weakness detection, transparent insight records, configurable thresholds, and versioned Analyzer Score if data supports it. |
| 5. Frontend MVP | Weeks 8–9 | Overview, agents, maps, insights, recent matches, loading/empty/error states. |
| 6. Private beta | Weeks 10–11 | RSO-tested opt-in, account privacy, exports, optional revocable sharing, security review, and feedback loop. |
| 7. Public launch readiness | Week 12+ | Riot access/policy requirements satisfied, production deployment and monitoring, privacy/retention docs, legal notice, backup/recovery test, and release checklist complete. Public launch is blocked until required API approval and consent flows work. |

## 12. Deployment and Operations

- Containerize the API and worker; host on AWS ECS or a comparable managed container platform.
- Use managed PostgreSQL, TLS, environment-specific secrets, automated migrations, and scheduled backups.
- Run ingestion through a worker/queue with bounded concurrency. `node-cron` can trigger jobs, but the job itself must be idempotent and safe across multiple app instances.
- Set up health checks, structured logs, error monitoring, API usage/rate-limit metrics, database monitoring, and alerts for sync failures.
- Use separate development, staging, and production environments. Never commit secrets or real player payloads to the repository.
- Define retention for raw payloads, match data, logs, and revoked accounts before beta.

## 13. Recommended Build Order

1. Build a small API feasibility spike and field-availability matrix first.
2. Register the product and start Riot production-key/RSO approval work immediately.
3. Implement data models and test fixtures based only on confirmed fields.
4. Finish secure account linking and ingestion before investing heavily in charts.
5. Build aggregates and prove them against test fixtures.
6. Add explainable insights, then scoring only after normalization and data coverage are validated.
7. Finish privacy/export/sharing controls, harden deployment, and release only when Riot policy and access prerequisites are satisfied.

## 14. Reference Links

- [Riot VALORANT Developer Documentation](https://developer.riotgames.com/docs/valorant) — current API endpoints, product registration, RSO, opt-in, and VALORANT-specific requirements.
- [Riot General Developer Policies](https://support-developer.riotgames.com/hc/en-us/articles/22698591841939-General-Policies) — product registration, supported data sources, game integrity, and required legal notice.
- [Riot VALORANT Performance Score article](https://support.riotgames.com/en-us/valorant/gameplay/performance-score) — description of the in-game Performance Score and what it measures.
- [Riot API Terms and Conditions](https://support-developer.riotgames.com/hc/en-us/articles/22698917218323-API-Terms-and-Conditions) — API usage terms and limitations.

---

**End of plan.**
