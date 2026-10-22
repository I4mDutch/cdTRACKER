# Fixtures

All data in `fixtures/riot/` is **synthetic**. It mimics the shape of Riot's VAL-MATCH-V1,
VAL-CONTENT-V1 and ACCOUNT-V1 responses but contains no real players, names or IDs.

Regenerate (deterministic, byte-identical output):

```
npm run fixtures
```

Layout:

- `riot/content.json` - agents and maps (`version: "fixture-1"`)
- `riot/accounts.json` - demo accounts with access tokens
- `riot/matchlists/<puuid>.json` - matchlists, newest first
- `riot/matches/<matchId>.json` - 69 matches (the matchlist for `demo-puuid-0001` has 70 entries, one duplicated)

Demo players: `demo-puuid-0001` (DemoPlayer#0001, 70 entries) and
`demo-puuid-0002` (OtherDemo#0002, 15 entries; these are a subset of the same 69 matches).

Planted pattern for `demo-puuid-0001`: win rate about 0.30 on Split vs about 0.55 elsewhere; about 0.9 deaths per round on Reyna vs about 0.7 otherwise.

## Edge cases (player demo-puuid-0001)

| Case | matchId |
|---|---|
| Remake (completed, 3 rounds) | `59197769-5cd7-411b-8463-d1d6d4d33795` |
| Incomplete (`isCompleted: false`) | `15f717bf-813b-462f-8e2d-0f948e22f613` |
| Draw 15-15 (`won: false` on both teams) | `d2a9313c-b719-411c-81ab-bd998e6a207a` |
| No round data (`roundResults: []`) | `da14aa40-9b2b-45c3-80dc-b40bb8f3fbdb`, `0ae6b475-c045-4adf-8b71-ece88f5eaeb7` |
| Unrated queue (`queueId: "unrated"`) | `fc3120eb-6b71-45aa-80ea-2ac9b2209748` |
| Zero deaths for the demo player | `2a44d836-1417-4d05-8139-1e8a35ffeaf6` |
| Listed twice in the matchlist | `ddfff7ba-871d-4daa-8fee-7b1f47808d81` |
