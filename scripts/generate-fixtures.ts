/**
 * Generates deterministic, synthetic Riot-shaped fixtures into fixtures/riot/.
 * No real players or IDs. Run with: npm run fixtures
 */
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type {
  RiotAccountDto,
  RiotContentDto,
  RiotDamageDto,
  RiotKillDto,
  RiotMatchDto,
  RiotMatchlistDto,
  RiotPlayerDto,
  RiotPlayerRoundStatsDto,
  RiotRoundResultDto,
  RiotTeamDto,
} from "@va/shared";

// ---------- PRNG / helpers ----------

type Rng = () => number;

function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const int = (rng: Rng, lo: number, hi: number): number => lo + Math.floor(rng() * (hi - lo + 1));
const choice = <T>(rng: Rng, arr: readonly T[]): T => arr[Math.floor(rng() * arr.length)] as T;

function shuffle<T>(rng: Rng, arr: readonly T[]): T[] {
  const out = arr.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = out[i] as T;
    out[i] = out[j] as T;
    out[j] = tmp;
  }
  return out;
}

function hex(rng: Rng, n: number): string {
  let s = "";
  for (let i = 0; i < n; i++) s += Math.floor(rng() * 16).toString(16);
  return s;
}

function uuid(rng: Rng): string {
  return `${hex(rng, 8)}-${hex(rng, 4)}-4${hex(rng, 3)}-8${hex(rng, 3)}-${hex(rng, 12)}`;
}

// ---------- constants ----------

const AGENT_NAMES = ["Jett", "Sova", "Omen", "Killjoy", "Sage", "Raze", "Reyna", "Breach"] as const;
const MAP_NAMES = ["Ascent", "Bind", "Haven", "Split", "Lotus", "Sunset"] as const;
type AgentName = (typeof AGENT_NAMES)[number];
type MapName = (typeof MAP_NAMES)[number];

const END_MS = Date.UTC(2026, 9, 1, 0, 0, 0);
const SPAN_MS = 120 * 24 * 3600 * 1000;
const START_MS = END_MS - SPAN_MS;
const ROUND_MS = 120000;

const N_MATCHES = 69; // unique matches; matchlist has 70 entries (one duplicate)
const DEMO1 = { puuid: "demo-puuid-0001", gameName: "DemoPlayer", tagLine: "0001" };
const DEMO2 = { puuid: "demo-puuid-0002", gameName: "OtherDemo", tagLine: "0002" };

const SEASON_ID = uuid(mulberry32(7));

const GAME_VERSIONS = [
  "release-09.06-shipping-12-2701001",
  "release-09.07-shipping-14-2711002",
  "release-09.08-shipping-9-2721003",
];

// Edge-case match indices (chronological index, 0 = oldest)
const IDX = {
  remake: 10,
  unrated: 15,
  incomplete: 20,
  duplicate: 25,
  draw: 30,
  emptyRounds1: 40,
  emptyRounds2: 50,
  zeroDeaths: 60,
} as const;
const EDGE = new Set<number>([
  IDX.remake,
  IDX.unrated,
  IDX.incomplete,
  IDX.draw,
  IDX.emptyRounds1,
  IDX.emptyRounds2,
  IDX.zeroDeaths,
]);

// ---------- content ----------

const contentRng = mulberry32(1);
const agentIds = new Map<AgentName, string>();
const mapIds = new Map<MapName, string>();
const content: RiotContentDto = {
  version: "fixture-1",
  characters: AGENT_NAMES.map((name) => {
    const id = uuid(contentRng);
    agentIds.set(name, id);
    return { id, name, assetName: name };
  }),
  maps: MAP_NAMES.map((name) => {
    const id = uuid(contentRng);
    mapIds.set(name, id);
    return { id, name, assetName: name, assetPath: `/Game/Maps/${name}/${name}` };
  }),
};

// ---------- round generation ----------

interface Slot {
  puuid: string;
  teamId: "Red" | "Blue";
}

const other = (t: "Red" | "Blue"): "Red" | "Blue" => (t === "Red" ? "Blue" : "Red");

function attackersOf(roundNum: number): "Red" | "Blue" {
  if (roundNum < 12) return "Red";
  if (roundNum < 24) return "Blue";
  return roundNum % 2 === 0 ? "Red" : "Blue";
}

interface RoundCtx {
  slots: Slot[];
  demo: Slot;
  pDie: number;
  neverDies: boolean;
}

const WEAPONS = ["Vandal", "Phantom", "Operator", "Sheriff", "Ghost", "Spectre"];

function genRound(
  rng: Rng,
  roundNum: number,
  winner: "Red" | "Blue",
  ctx: RoundCtx,
): RiotRoundResultDto {
  const { slots, demo } = ctx;
  const attackers = attackersOf(roundNum);
  const defenders = other(attackers);
  const alive = new Set(slots.map((s) => s.puuid));
  const teamOf = new Map(slots.map((s) => [s.puuid, s.teamId] as const));
  const deaths: Record<string, number> = { Red: 0, Blue: 0 };
  const cap = (t: string) => (t === winner ? 4 : 5);
  const deathTime = new Map<string, number>();

  const k = Math.max(1, Math.min(8, Math.round(2 + rng() * 3 + rng() * 3)));
  const demoDies = !ctx.neverDies && rng() < ctx.pDie;
  const demoStep = demoDies ? int(rng, 0, k - 1) : -1;
  let demoDied = false;

  const times = Array.from({ length: k }, () => int(rng, 5000, 100000)).sort((a, b) => a - b);
  for (let i = 1; i < times.length; i++) {
    if ((times[i] as number) <= (times[i - 1] as number)) times[i] = (times[i - 1] as number) + 500;
  }

  const kills: RiotKillDto[] = [];
  const killerOf: string[] = [];
  const victimOf: string[] = [];

  const victimCandidates = (team: "Red" | "Blue"): string[] => {
    const reserve = team === demo.teamId && demoDies && !demoDied ? 1 : 0;
    if (deaths[team]! + reserve >= cap(team)) return [];
    return slots
      .filter((s) => s.teamId === team && alive.has(s.puuid) && s.puuid !== demo.puuid)
      .map((s) => s.puuid);
  };
  const aliveOn = (team: "Red" | "Blue"): string[] =>
    slots.filter((s) => s.teamId === team && alive.has(s.puuid)).map((s) => s.puuid);

  for (let step = 0; step < k; step++) {
    let killer: string | undefined;
    let victim: string | undefined;
    if (step === demoStep) {
      const kt = other(demo.teamId);
      const ks = aliveOn(kt);
      if (ks.length > 0 && alive.has(demo.puuid)) {
        killer = choice(rng, ks);
        victim = demo.puuid;
      }
    } else {
      let kt: "Red" | "Blue" = rng() < 0.6 ? winner : other(winner);
      for (let attempt = 0; attempt < 2 && !victim; attempt++) {
        const ks = aliveOn(kt);
        const vs = victimCandidates(other(kt));
        if (ks.length > 0 && vs.length > 0) {
          killer = choice(rng, ks);
          victim = choice(rng, vs);
        } else {
          kt = other(kt);
        }
      }
    }
    if (!killer || !victim) continue;

    const t = times[step] as number;
    const killerTeam = teamOf.get(killer)!;
    const mates = aliveOn(killerTeam).filter((p) => p !== killer);
    const roll = rng();
    const nAssist = Math.min(mates.length, roll < 0.5 ? 0 : roll < 0.85 ? 1 : 2);
    const assistants = shuffle(rng, mates).slice(0, nAssist);

    kills.push({
      timeSinceGameStartMillis: roundNum * ROUND_MS + t,
      timeSinceRoundStartMillis: t,
      killer,
      victim,
      victimLocation: { x: int(rng, -2000, 9000), y: int(rng, -9000, 4000) },
      assistants,
      finishingDamage: {
        damageType: "Weapon",
        damageItem: choice(rng, WEAPONS),
        isSecondaryFireMode: false,
      },
    });
    killerOf.push(killer);
    victimOf.push(victim);
    alive.delete(victim);
    deaths[teamOf.get(victim)!]!++;
    deathTime.set(victim, t);
    if (victim === demo.puuid) demoDied = true;
  }

  // Bomb
  const aliveAt = (p: string, t: number) => {
    const d = deathTime.get(p);
    return d === undefined || d > t;
  };
  let bombPlanter: string | null = null;
  let bombDefuser: string | null = null;
  let plantRoundTime: number | undefined;
  let plantSite: string | undefined;
  let defuseRoundTime: number | undefined;
  if (rng() < 0.5) {
    const pt = int(rng, 15000, 70000);
    const cands = slots.filter((s) => s.teamId === attackers && aliveAt(s.puuid, pt));
    if (cands.length > 0) {
      bombPlanter = choice(rng, cands).puuid;
      plantRoundTime = pt;
      plantSite = choice(rng, ["A", "B", "C"]);
      if (winner === defenders && rng() < 0.5) {
        const dt = pt + int(rng, 10000, 30000);
        const dc = slots.filter((s) => s.teamId === defenders && aliveAt(s.puuid, dt));
        if (dc.length > 0) {
          bombDefuser = choice(rng, dc).puuid;
          defuseRoundTime = dt;
        }
      }
    }
  }
  let roundResult = "Elimination";
  let roundResultCode = "Elimination";
  if (bombDefuser) {
    roundResult = "Bomb defused";
    roundResultCode = "Defuse";
  } else if (bombPlanter && winner === attackers) {
    roundResult = "Bomb detonated";
    roundResultCode = "Detonate";
  }

  const playerStats: RiotPlayerRoundStatsDto[] = slots.map((s) => {
    const myKills = kills.filter((kl) => kl.killer === s.puuid);
    const damage: RiotDamageDto[] = myKills.map((kl) => {
      const total = int(rng, 100, 160);
      const headshots = int(rng, 0, 1);
      const legshots = int(rng, 0, 1);
      return {
        receiver: kl.victim,
        damage: total,
        headshots,
        bodyshots: int(rng, 1, 3),
        legshots,
      };
    });
    const score = 150 * myKills.length + damage.reduce((a, d) => a + Math.round(d.damage / 2), 0);
    return {
      puuid: s.puuid,
      kills: myKills,
      damage,
      score,
      economy: {
        loadoutValue: int(rng, 800, 9000),
        weapon: choice(rng, WEAPONS),
        armor: choice(rng, ["Light", "Heavy", "None"]),
        remaining: int(rng, 0, 4000),
        spent: int(rng, 0, 5000),
      },
    };
  });

  const round: RiotRoundResultDto = {
    roundNum,
    roundResult,
    roundCeremony: "CeremonyDefault",
    winningTeam: winner,
    bombPlanter,
    bombDefuser,
    roundResultCode,
    playerStats,
  };
  if (plantRoundTime !== undefined) {
    round.plantRoundTime = plantRoundTime;
    round.plantSite = plantSite!;
  }
  if (defuseRoundTime !== undefined) round.defuseRoundTime = defuseRoundTime;
  return round;
}

/** Sequence of round winners as "W"/"L" markers. */
function roundSequence(
  rng: Rng,
  kind: "standard" | "ot1412" | "ot1513" | "draw" | "remake" | "incomplete",
  loserRounds: number,
): ("W" | "L")[] {
  switch (kind) {
    case "standard": {
      const body = shuffle(rng, [...Array(12).fill("W"), ...Array(loserRounds).fill("L")] as ("W" | "L")[]);
      return [...body, "W"];
    }
    case "ot1412":
      return [...shuffle(rng, [...Array(12).fill("W"), ...Array(12).fill("L")] as ("W" | "L")[]), "W", "W"];
    case "ot1513":
      return [
        ...shuffle(rng, [...Array(12).fill("W"), ...Array(12).fill("L")] as ("W" | "L")[]),
        "W",
        "L",
        "W",
        "W",
      ];
    case "draw":
      return shuffle(rng, [...Array(15).fill("W"), ...Array(15).fill("L")] as ("W" | "L")[]);
    case "remake":
      return ["W", "W", "W"];
    case "incomplete":
      return shuffle(rng, [...Array(7).fill("W"), ...Array(5).fill("L")] as ("W" | "L")[]);
  }
}

// ---------- scheduling (agents, maps, outcomes) ----------

const planRng = mulberry32(42);

// Maps: Split never lands on an edge-case match.
const nonEdgeIdx = Array.from({ length: N_MATCHES }, (_, i) => i).filter((i) => !EDGE.has(i));
const edgeIdx = Array.from(EDGE).sort((a, b) => a - b);
const mapPlan: MapName[] = new Array(N_MATCHES);
{
  const nonEdgeMaps: MapName[] = [
    ...Array<MapName>(12).fill("Split"),
    ...Array<MapName>(10).fill("Ascent"),
    ...Array<MapName>(10).fill("Bind"),
    ...Array<MapName>(10).fill("Haven"),
    ...Array<MapName>(10).fill("Lotus"),
    ...Array<MapName>(10).fill("Sunset"),
  ];
  const shuffled = shuffle(planRng, nonEdgeMaps);
  nonEdgeIdx.forEach((mi, n) => (mapPlan[mi] = shuffled[n] as MapName));
  const edgeMaps: MapName[] = ["Ascent", "Bind", "Haven", "Lotus", "Sunset", "Ascent", "Bind"];
  edgeIdx.forEach((mi, n) => (mapPlan[mi] = edgeMaps[n % edgeMaps.length] as MapName));
}

// Agents for player 0001 (counts sum to 69).
const agentPlan: AgentName[] = shuffle(planRng, [
  ...Array<AgentName>(20).fill("Jett"),
  ...Array<AgentName>(16).fill("Sova"),
  ...Array<AgentName>(15).fill("Reyna"),
  ...Array<AgentName>(10).fill("Omen"),
  ...Array<AgentName>(3).fill("Raze"),
  ...Array<AgentName>(2).fill("Sage"),
  ...Array<AgentName>(2).fill("Breach"),
  ...Array<AgentName>(1).fill("Killjoy"),
]);
if (agentPlan[IDX.zeroDeaths] === "Reyna") {
  const t = agentPlan[0] as AgentName;
  agentPlan[0] = "Reyna";
  agentPlan[IDX.zeroDeaths] = t === "Reyna" ? "Jett" : t;
}

// Win plan via quotas: Split ~0.30, elsewhere ~0.55 (non-edge matches only).
const winPlan = new Map<number, boolean>();
{
  const splitIdx = nonEdgeIdx.filter((i) => mapPlan[i] === "Split");
  const restIdx = nonEdgeIdx.filter((i) => mapPlan[i] !== "Split");
  const assign = (list: number[], p: number) => {
    const s = shuffle(planRng, list);
    const wins = Math.round(p * list.length);
    s.forEach((mi, n) => winPlan.set(mi, n < wins));
  };
  assign(splitIdx, 0.3);
  assign(restIdx, 0.55);
  winPlan.set(IDX.remake, true);
  winPlan.set(IDX.unrated, planRng() < 0.5);
  winPlan.set(IDX.emptyRounds1, true);
  winPlan.set(IDX.emptyRounds2, false);
  winPlan.set(IDX.zeroDeaths, true);
}

// Player 0002 appears in 15 of player 0001's matches (none of the edge cases).
const demo2Matches = new Set<number>();
for (let i = 2; i < N_MATCHES; i += 5) demo2Matches.add(i);
demo2Matches.add(68);

// ---------- match construction ----------

const idRng = mulberry32(2);
const matchIds: string[] = Array.from({ length: N_MATCHES }, () => uuid(idRng));

function matchStart(i: number): number {
  const jitter = Math.floor(mulberry32(5000 + i)() * 3600 * 1000);
  return Math.floor(START_MS + ((i + 0.5) * SPAN_MS) / N_MATCHES) + jitter;
}

function versionFor(ms: number): string {
  const third = Math.min(2, Math.floor(((ms - START_MS) / SPAN_MS) * 3));
  return GAME_VERSIONS[third] as string;
}

function buildMatch(i: number): RiotMatchDto {
  const rng = mulberry32(10000 + i);
  const mapName = mapPlan[i] as MapName;
  const agent = agentPlan[i] as AgentName;
  const hasDemo2 = demo2Matches.has(i);

  // Kind of match
  let kind: "standard" | "ot1412" | "ot1513" | "draw" | "remake" | "incomplete" = "standard";
  if (i === IDX.remake) kind = "remake";
  else if (i === IDX.incomplete) kind = "incomplete";
  else if (i === IDX.draw) kind = "draw";
  else {
    const r = rng();
    if (r < 0.06) kind = "ot1412";
    else if (r < 0.12) kind = "ot1513";
  }
  const demoWins = winPlan.get(i) ?? false;
  const demoTeam: "Red" | "Blue" = rng() < 0.5 ? "Red" : "Blue";
  const winnerTeam = demoWins ? demoTeam : other(demoTeam);
  const loserRounds = int(rng, 3, 11);
  const seq = roundSequence(rng, kind, loserRounds);
  const roundWinners = seq.map((m) => (m === "W" ? winnerTeam : other(winnerTeam)));

  // Players
  const teamSlots: Record<"Red" | "Blue", Slot[]> = { Red: [], Blue: [] };
  const players: RiotPlayerDto[] = [];
  const meta = new Map<string, { gameName: string; tagLine: string; agent: AgentName }>();
  const demoSlotPos = int(rng, 0, 4);
  let otherN = 0;
  let demo2Placed = !hasDemo2;
  const demoRef: Slot = { puuid: DEMO1.puuid, teamId: demoTeam };
  for (const team of ["Red", "Blue"] as const) {
    for (let pos = 0; pos < 5; pos++) {
      if (team === demoTeam && pos === demoSlotPos) {
        teamSlots[team].push(demoRef);
        meta.set(DEMO1.puuid, { gameName: DEMO1.gameName, tagLine: DEMO1.tagLine, agent });
        continue;
      }
      otherN++;
      const isDemo2 = !demo2Placed && team === other(demoTeam) && pos === 0;
      const puuid = isDemo2 ? DEMO2.puuid : `synthetic-${i}-${otherN}`;
      if (isDemo2) demo2Placed = true;
      teamSlots[team].push({ puuid, teamId: team });
      meta.set(puuid, {
        gameName: isDemo2 ? DEMO2.gameName : `Player${otherN}`,
        tagLine: isDemo2 ? DEMO2.tagLine : String(1000 + otherN),
        agent: choice(rng, AGENT_NAMES),
      });
    }
  }
  const slots: Slot[] = [...teamSlots.Red, ...teamSlots.Blue];

  const neverDies = i === IDX.zeroDeaths;
  const pDie = agent === "Reyna" ? 0.9 : 0.7;
  const ctx: RoundCtx = { slots, demo: demoRef, pDie, neverDies };
  const rounds = roundWinners.map((w, n) => genRound(rng, n, w, ctx));

  // Aggregate stats
  const totals = new Map<string, { k: number; d: number; a: number; score: number }>();
  for (const s of slots) totals.set(s.puuid, { k: 0, d: 0, a: 0, score: 0 });
  for (const r of rounds) {
    for (const ps of r.playerStats) {
      const t = totals.get(ps.puuid)!;
      t.score += ps.score;
      for (const kl of ps.kills) {
        t.k++;
        totals.get(kl.victim)!.d++;
        for (const a of kl.assistants) totals.get(a)!.a++;
      }
    }
  }

  const partyIds = new Map<string, string>();
  const partyRng = mulberry32(20000 + i);
  for (const s of slots) {
    players.push({
      puuid: s.puuid,
      gameName: meta.get(s.puuid)!.gameName,
      tagLine: meta.get(s.puuid)!.tagLine,
      teamId: s.teamId,
      partyId: partyIds.get(s.teamId) ?? (partyIds.set(s.teamId, uuid(partyRng)), partyIds.get(s.teamId)!),
      characterId: agentIds.get(meta.get(s.puuid)!.agent)!,
      stats: {
        score: totals.get(s.puuid)!.score,
        roundsPlayed: rounds.length,
        kills: totals.get(s.puuid)!.k,
        deaths: totals.get(s.puuid)!.d,
        assists: totals.get(s.puuid)!.a,
        playtimeMillis: rounds.length * 100000 + int(rng, 0, 20000),
        abilityCasts: {
          grenadeCasts: int(rng, 0, 12),
          ability1Casts: int(rng, 0, 20),
          ability2Casts: int(rng, 0, 20),
          ultimateCasts: int(rng, 0, 4),
        },
      },
      competitiveTier: int(rng, 12, 18),
    });
  }

  // Teams
  const wonCount = (t: string) => roundWinners.filter((w) => w === t).length;
  const decided = kind !== "draw" && kind !== "incomplete";
  const teams: RiotTeamDto[] = (["Red", "Blue"] as const).map((t) => ({
    teamId: t,
    won: decided && t === winnerTeam,
    roundsPlayed: rounds.length,
    roundsWon: wonCount(t),
    numPoints: wonCount(t),
  }));

  const start = matchStart(i);
  const queueId = i === IDX.unrated ? "unrated" : "competitive";
  const matchInfo: RiotMatchDto["matchInfo"] = {
    matchId: matchIds[i] as string,
    mapId: `/Game/Maps/${mapName}/${mapName}`,
    gameLengthMillis: kind === "incomplete" ? null : rounds.length * 100000 + int(rng, 60000, 240000),
    gameStartMillis: start,
    provisioningFlowId: "Matchmaking",
    isCompleted: kind !== "incomplete",
    customGameName: "",
    queueId,
    gameMode: "/Game/GameModes/Bomb/BombGameMode.BombGameMode_C",
    isRanked: queueId === "competitive",
    seasonId: SEASON_ID,
    gameVersion: versionFor(start),
  };

  const noRounds = i === IDX.emptyRounds1 || i === IDX.emptyRounds2;
  return { matchInfo, players, teams, roundResults: noRounds ? [] : rounds };
}

// ---------- write ----------

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = resolve(root, "fixtures", "riot");
rmSync(outDir, { recursive: true, force: true });
mkdirSync(resolve(outDir, "matchlists"), { recursive: true });
mkdirSync(resolve(outDir, "matches"), { recursive: true });

const write = (path: string, data: unknown) =>
  writeFileSync(path, JSON.stringify(data, null, 2) + "\n");

write(resolve(outDir, "content.json"), content);

const accounts: { accessToken: string; account: RiotAccountDto; shard: "na" }[] = [
  { accessToken: "fixture-token-0001", account: { ...DEMO1 }, shard: "na" },
  { accessToken: "fixture-token-0002", account: { ...DEMO2 }, shard: "na" },
];
write(resolve(outDir, "accounts.json"), accounts);

const matches: RiotMatchDto[] = [];
for (let i = 0; i < N_MATCHES; i++) {
  const m = buildMatch(i);
  matches.push(m);
  write(resolve(outDir, "matches", `${m.matchInfo.matchId}.json`), m);
}

const entryOf = (i: number) => ({
  matchId: matches[i]!.matchInfo.matchId,
  gameStartTimeMillis: matches[i]!.matchInfo.gameStartMillis,
  queueId: matches[i]!.matchInfo.queueId,
});

const history1 = [];
for (let i = N_MATCHES - 1; i >= 0; i--) {
  history1.push(entryOf(i));
  if (i === IDX.duplicate) history1.push(entryOf(i));
}
const list1: RiotMatchlistDto = { puuid: DEMO1.puuid, history: history1 };
write(resolve(outDir, "matchlists", `${DEMO1.puuid}.json`), list1);

const history2 = [];
for (let i = N_MATCHES - 1; i >= 0; i--) if (demo2Matches.has(i)) history2.push(entryOf(i));
const list2: RiotMatchlistDto = { puuid: DEMO2.puuid, history: history2 };
write(resolve(outDir, "matchlists", `${DEMO2.puuid}.json`), list2);

const id = (i: number) => `\`${matchIds[i]}\``;
const readme = `# Fixtures

All data in \`fixtures/riot/\` is **synthetic**. It mimics the shape of Riot's VAL-MATCH-V1,
VAL-CONTENT-V1 and ACCOUNT-V1 responses but contains no real players, names or IDs.

Regenerate (deterministic, byte-identical output):

\`\`\`
npm run fixtures
\`\`\`

Layout:

- \`riot/content.json\` - agents and maps (\`version: "fixture-1"\`)
- \`riot/accounts.json\` - demo accounts with access tokens
- \`riot/matchlists/<puuid>.json\` - matchlists, newest first
- \`riot/matches/<matchId>.json\` - ${N_MATCHES} matches (the matchlist for \`${DEMO1.puuid}\` has ${history1.length} entries, one duplicated)

Demo players: \`${DEMO1.puuid}\` (${DEMO1.gameName}#${DEMO1.tagLine}, ${history1.length} entries) and
\`${DEMO2.puuid}\` (${DEMO2.gameName}#${DEMO2.tagLine}, ${history2.length} entries; these are a subset of the same ${N_MATCHES} matches).

Planted pattern for \`${DEMO1.puuid}\`: win rate about 0.30 on Split vs about 0.55 elsewhere; about 0.9 deaths per round on Reyna vs about 0.7 otherwise.

## Edge cases (player ${DEMO1.puuid})

| Case | matchId |
|---|---|
| Remake (completed, 3 rounds) | ${id(IDX.remake)} |
| Incomplete (\`isCompleted: false\`) | ${id(IDX.incomplete)} |
| Draw 15-15 (\`won: false\` on both teams) | ${id(IDX.draw)} |
| No round data (\`roundResults: []\`) | ${id(IDX.emptyRounds1)}, ${id(IDX.emptyRounds2)} |
| Unrated queue (\`queueId: "unrated"\`) | ${id(IDX.unrated)} |
| Zero deaths for the demo player | ${id(IDX.zeroDeaths)} |
| Listed twice in the matchlist | ${id(IDX.duplicate)} |
`;
writeFileSync(resolve(root, "fixtures", "README.md"), readme);

console.log(`Wrote ${N_MATCHES} matches, ${history1.length}+${history2.length} matchlist entries to ${outDir}`);
