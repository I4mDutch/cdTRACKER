/** Minimal hand-written Riot-shaped match payload builder for normalize tests. */
export type Raw = Record<string, any>;

export const A = 'puuid-a'; // Red
export const B = 'puuid-b'; // Red
export const C = 'puuid-c'; // Blue

export function kill(killer: string, victim: string, t: number): Raw {
  return { timeSinceGameStartMillis: t + 1000, timeSinceRoundStartMillis: t, killer, victim, assistants: [] };
}

export function round(roundNum: number, winningTeam: string, opts: Raw = {}): Raw {
  return {
    roundNum,
    roundResult: 'Eliminated',
    winningTeam,
    bombPlanter: null,
    bombDefuser: null,
    playerStats: [
      { puuid: A, kills: [], damage: [], score: 0 },
      { puuid: C, kills: [], damage: [], score: 0 },
    ],
    ...opts,
  };
}

/** Valid 13-x match: Red wins 13-x; rounds list is `redWins` Red rounds then `blueWins` Blue rounds. */
export function buildMatch(over: Raw = {}, redWins = 13, blueWins = 5): Raw {
  const total = redWins + blueWins;
  const roundResults: Raw[] = [];
  for (let i = 0; i < total; i++) roundResults.push(round(i, i < redWins ? 'Red' : 'Blue'));
  return {
    matchInfo: {
      matchId: 'm1',
      mapId: '/Game/Maps/Ascent/Ascent',
      gameLengthMillis: 1_800_000,
      gameStartMillis: 1_700_000_000_000,
      isCompleted: true,
      queueId: 'competitive',
      seasonId: 'season-1',
      gameVersion: 'release-08.11-shipping-6-2545312',
    },
    players: [
      { puuid: A, teamId: 'Red', characterId: 'agent-1', stats: { score: 4000, roundsPlayed: total, kills: 15, deaths: 10, assists: 3 } },
      { puuid: B, teamId: 'Red', characterId: 'agent-2', stats: { score: 3000, roundsPlayed: total, kills: 10, deaths: 12, assists: 5 } },
      { puuid: C, teamId: 'Blue', characterId: 'agent-3', stats: { score: 3500, roundsPlayed: total, kills: 12, deaths: 15, assists: 2 } },
    ],
    teams: [
      { teamId: 'Red', won: redWins > blueWins, roundsPlayed: total, roundsWon: redWins },
      { teamId: 'Blue', won: blueWins > redWins, roundsPlayed: total, roundsWon: blueWins },
    ],
    roundResults,
    ...over,
  };
}
