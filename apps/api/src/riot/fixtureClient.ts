import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { RiotAccountDto, RiotContentDto, RiotMatchlistDto } from '@va/shared';
import { RiotApiError, type RiotClient, type RiotShard } from './types';

/** <repo>/fixtures/riot, resolved relative to this file (apps/api/src/riot). */
export const DEFAULT_FIXTURE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../fixtures/riot');

const SAFE_SEGMENT = /^[A-Za-z0-9-]+$/;

interface FixtureAccountEntry {
  accessToken: string;
  account: RiotAccountDto;
  shard: 'na';
}

export class FixtureRiotClient implements RiotClient {
  private readonly dir: string;

  constructor(opts: { dir: string }) {
    this.dir = opts.dir;
  }

  private async readJson(segments: string[], notFoundMessage: string): Promise<unknown> {
    if (!segments.every((s) => SAFE_SEGMENT.test(s))) {
      throw new RiotApiError(notFoundMessage, 'not_found', 404);
    }
    const last = segments[segments.length - 1] as string;
    const file = path.join(this.dir, ...segments.slice(0, -1), `${last}.json`);
    try {
      return JSON.parse(await readFile(file, 'utf8'));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new RiotApiError(notFoundMessage, 'not_found', 404);
      }
      throw err;
    }
  }

  async getMyAccount(accessToken: string): Promise<RiotAccountDto> {
    const accounts = (await readFile(path.join(this.dir, 'accounts.json'), 'utf8').then(JSON.parse)) as FixtureAccountEntry[];
    const entry = accounts.find((a) => a.accessToken === accessToken);
    if (!entry) throw new RiotApiError('Unknown access token', 'auth', 401);
    return entry.account;
  }

  async getMatchlist(puuid: string, _shard: RiotShard): Promise<RiotMatchlistDto> {
    return (await this.readJson(['matchlists', puuid], 'Matchlist not found')) as RiotMatchlistDto;
  }

  async getMatch(matchId: string, _shard: RiotShard): Promise<unknown> {
    return this.readJson(['matches', matchId], 'Match not found');
  }

  async getContent(_shard: RiotShard): Promise<RiotContentDto> {
    return JSON.parse(await readFile(path.join(this.dir, 'content.json'), 'utf8')) as RiotContentDto;
  }
}
