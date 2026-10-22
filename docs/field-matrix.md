# API field-availability matrix

Status: **confirmed** = in Riot's published VAL-MATCH-V1 / VAL-CONTENT-V1 / ACCOUNT-V1 DTO docs;
**must verify** = documented, but must be confirmed against an approved production response before the UI depends on it;
**unavailable** = not in the documented API; the app must show it as unavailable and never fabricate it.

Until a production key is approved, every "confirmed" row is effectively "must verify" — re-run the
API contract tests (`apps/api/test/riot-contract.test.ts`, live mode) once access exists.

| Product need | Source field | Status | Notes |
|---|---|---|---|
| Account PUUID | `accounts/me.puuid` | confirmed | via RSO access token |
| Match IDs | `matchlists.history[].matchId` | confirmed | |
| Start time | `matchInfo.gameStartMillis` | confirmed | |
| Duration | `matchInfo.gameLengthMillis` | must verify | nullable |
| Map | `matchInfo.mapId` (asset path) | confirmed | joined to content `maps[].assetPath` |
| Queue | `matchInfo.queueId` | confirmed | only `competitive` analyzed by default |
| Completion | `matchInfo.isCompleted` | confirmed | incomplete → excluded |
| Patch | `matchInfo.gameVersion` | must verify | parsed to `8.11`; null if unparseable |
| Season | `matchInfo.seasonId` | confirmed | |
| Agent | `players[].characterId` | confirmed | joined to content `characters[].id` |
| K / D / A | `players[].stats.kills/deaths/assists` | confirmed | |
| Rounds played | `players[].stats.roundsPlayed`, `teams[].roundsPlayed` | confirmed | |
| Combat score (ACS) | `players[].stats.score` | confirmed | This is combat score, **not** Performance Score |
| Win / loss / draw | `teams[].won`, `teams[].roundsWon` | confirmed | draw = no team won |
| Damage, HS/BS/LS | `roundResults[].playerStats[].damage[]` | must verify | round-derived; null when rounds missing |
| First kill / death | `roundResults[].playerStats[].kills[].timeSinceRoundStartMillis` | must verify | earliest kill per round |
| Plants / defuses | `roundResults[].bombPlanter/bombDefuser` | must verify | |
| Performance Score (0–500) | — | **unavailable** | Not in documented MatchDto. Stored as null; UI says unavailable |
| Map Rating | — | **unavailable** | Not a Riot field; custom Map Impact Score deferred |
| Clutch conversion | derivable from kill events | deferred | not in v1 analysis |
| Positioning / crosshair | — | **unavailable** | never inferred |
