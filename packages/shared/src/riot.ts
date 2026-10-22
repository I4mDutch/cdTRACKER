/**
 * Subset of Riot's documented VAL-MATCH-V1 / VAL-CONTENT-V1 / ACCOUNT-V1 DTOs that this
 * product reads. Every field here is listed in docs/field-matrix.md with its status.
 * Fields are typed as optional where Riot's docs or observed payloads show they may be absent;
 * the normalizer must never assume an optional field exists.
 *
 * NOTE: Riot does NOT document an in-game "Performance Score" field on MatchDto.
 * Do not add one here until it is confirmed in an approved production response.
 */

export interface RiotAccountDto {
  puuid: string;
  gameName?: string;
  tagLine?: string;
}

export interface RiotMatchlistEntryDto {
  matchId: string;
  gameStartTimeMillis: number;
  queueId: string;
}

export interface RiotMatchlistDto {
  puuid: string;
  history: RiotMatchlistEntryDto[];
}

export interface RiotMatchInfoDto {
  matchId: string;
  /** Asset path, e.g. "/Game/Maps/Ascent/Ascent". Join to content maps[].assetPath. */
  mapId: string;
  gameLengthMillis?: number | null;
  gameStartMillis: number;
  provisioningFlowId?: string;
  isCompleted: boolean;
  customGameName?: string;
  /** e.g. "competitive", "unrated", "swiftplay", "premier", "" for custom */
  queueId: string;
  gameMode?: string;
  isRanked?: boolean;
  seasonId?: string;
  /** e.g. "release-08.11-shipping-6-2545312". Used to derive patch "8.11". */
  gameVersion?: string;
}

export interface RiotAbilityCastsDto {
  grenadeCasts?: number;
  ability1Casts?: number;
  ability2Casts?: number;
  ultimateCasts?: number;
}

export interface RiotPlayerStatsDto {
  /** Combat score (ACS * rounds). NOT the Riot Performance Score. */
  score: number;
  roundsPlayed: number;
  kills: number;
  deaths: number;
  assists: number;
  playtimeMillis?: number;
  abilityCasts?: RiotAbilityCastsDto | null;
}

export interface RiotPlayerDto {
  puuid: string;
  gameName?: string;
  tagLine?: string;
  teamId: string;
  partyId?: string;
  /** Agent UUID. Join to content characters[].id. */
  characterId: string;
  stats?: RiotPlayerStatsDto | null;
  competitiveTier?: number;
  playerCard?: string;
  playerTitle?: string;
}

export interface RiotTeamDto {
  /** "Red" | "Blue" in standard modes */
  teamId: string;
  won: boolean;
  roundsPlayed: number;
  roundsWon: number;
  numPoints?: number;
}

export interface RiotLocationDto {
  x: number;
  y: number;
}

export interface RiotKillDto {
  timeSinceGameStartMillis: number;
  timeSinceRoundStartMillis: number;
  killer: string;
  victim: string;
  victimLocation?: RiotLocationDto;
  assistants: string[];
  finishingDamage?: {
    damageType?: string;
    damageItem?: string;
    isSecondaryFireMode?: boolean;
  };
}

export interface RiotDamageDto {
  receiver: string;
  damage: number;
  legshots: number;
  bodyshots: number;
  headshots: number;
}

export interface RiotEconomyDto {
  loadoutValue?: number;
  weapon?: string;
  armor?: string;
  remaining?: number;
  spent?: number;
}

export interface RiotPlayerRoundStatsDto {
  puuid: string;
  kills: RiotKillDto[];
  damage: RiotDamageDto[];
  score: number;
  economy?: RiotEconomyDto;
}

export interface RiotRoundResultDto {
  /** 0-based in Riot payloads. */
  roundNum: number;
  roundResult: string;
  roundCeremony?: string;
  winningTeam: string;
  bombPlanter?: string | null;
  bombDefuser?: string | null;
  plantRoundTime?: number;
  plantSite?: string;
  defuseRoundTime?: number;
  roundResultCode?: string;
  playerStats: RiotPlayerRoundStatsDto[];
}

export interface RiotMatchDto {
  matchInfo: RiotMatchInfoDto;
  players: RiotPlayerDto[];
  coaches?: { puuid: string; teamId: string }[];
  teams: RiotTeamDto[] | null;
  /** May be absent or empty; round-level metrics must then be reported as unavailable. */
  roundResults?: RiotRoundResultDto[] | null;
}

export interface RiotContentItemDto {
  id: string;
  name: string;
  assetName?: string;
  /** Present on maps: matches RiotMatchInfoDto.mapId */
  assetPath?: string;
}

export interface RiotContentDto {
  version: string;
  characters: RiotContentItemDto[];
  maps: RiotContentItemDto[];
}
