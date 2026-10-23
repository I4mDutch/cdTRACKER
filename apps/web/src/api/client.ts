import type {
  ApiError,
  BreakdownResponse,
  ConnectResponse,
  CreateShareLinkRequest,
  FilterOptionsResponse,
  InsightFeedbackRequest,
  ImportRequest,
  ImportResponse,
  InsightsResponse,
  MatchDetailDto,
  MatchFilter,
  ManualMatchDto,
  ManualMatchInput,
  MatchSummaryDto,
  MeResponse,
  Paginated,
  PublicProfileDto,
  ScoreResponse,
  ShareLinkDto,
  SummaryResponse,
  SyncResponse,
} from '@va/shared';

export class ApiClientError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'ApiClientError';
    this.status = status;
    this.code = code;
  }
}

/** Serialize params, omitting undefined / null / empty-string values. */
export function buildQuery(params: Record<string, string | number | boolean | undefined | null>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue;
    sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : '';
}

export function filterParams(filter: MatchFilter): Record<string, string | number | undefined> {
  return {
    agentId: filter.agentId,
    mapId: filter.mapId,
    queueId: filter.queueId,
    patch: filter.patch,
    from: filter.from,
    to: filter.to,
    lastN: filter.lastN,
    source: filter.source,
  };
}

async function parseError(res: Response): Promise<ApiClientError> {
  try {
    const body = (await res.json()) as Partial<ApiError>;
    if (body && body.error) return new ApiClientError(res.status, body.error.code, body.error.message);
  } catch {
    /* fall through */
  }
  return new ApiClientError(res.status, 'unknown', `Request failed (${res.status})`);
}

async function request<T>(method: 'GET' | 'POST' | 'PUT' | 'DELETE', path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {};
  if (method !== 'GET') {
    headers['X-Requested-With'] = 'va-web';
    headers['Content-Type'] = 'application/json';
  }
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method,
      credentials: 'include',
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiClientError(0, 'network', 'Could not reach the server. Check your connection and try again.');
  }
  if (!res.ok) throw await parseError(res);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

const get = <T>(path: string) => request<T>('GET', path);

export const getMe = () => get<MeResponse>('/me');
export const devLogin = () => request<MeResponse>('POST', '/dev/login');
export const logout = () => request<void>('POST', '/logout');
export const connectRiot = () => request<ConnectResponse>('POST', '/riot/connect', { consent: true });
export const startSync = () => request<SyncResponse>('POST', '/sync');
export const getSyncJob = (jobId: string) => get<SyncResponse>(`/sync/${encodeURIComponent(jobId)}`);
export const getFilterOptions = () => get<FilterOptionsResponse>('/filters/options');
export const getMatches = (filter: MatchFilter, page = 1, pageSize = 20) =>
  get<Paginated<MatchSummaryDto>>(`/matches${buildQuery({ page, pageSize, ...filterParams(filter) })}`);
export const getMatch = (matchId: string) => get<MatchDetailDto>(`/matches/${encodeURIComponent(matchId)}`);
export const getSummary = (filter: MatchFilter) =>
  get<SummaryResponse>(`/summary${buildQuery(filterParams(filter))}`);
export const getAgents = (filter: MatchFilter) =>
  get<BreakdownResponse>(`/agents${buildQuery(filterParams(filter))}`);
export const getMaps = (filter: MatchFilter) => get<BreakdownResponse>(`/maps${buildQuery(filterParams(filter))}`);
export const getInsights = (filter: MatchFilter) =>
  get<InsightsResponse>(`/insights${buildQuery(filterParams(filter))}`);
export const sendInsightFeedback = (req: InsightFeedbackRequest) =>
  request<void>('POST', '/insights/feedback', req);
export const getScore = (filter: MatchFilter) => get<ScoreResponse>(`/score${buildQuery(filterParams(filter))}`);
export const exportCsvUrl = (filter: MatchFilter) => `/api/export.csv${buildQuery(filterParams(filter))}`;
export const getShareLinks = () => get<ShareLinkDto[]>('/share-links');
export const createShareLink = (req: CreateShareLinkRequest) =>
  request<ShareLinkDto>('POST', '/share-links', req);
export const revokeShareLink = (id: string) => request<void>('DELETE', `/share-links/${encodeURIComponent(id)}`);
export const getPublicProfile = (token: string) =>
  get<PublicProfileDto>(`/public/${encodeURIComponent(token)}`);
export const unlinkAccount = () => request<void>('DELETE', '/account-link');

export const createManualMatch = (input: ManualMatchInput) =>
  request<ManualMatchDto>('POST', '/manual-matches', input);
export const getManualMatch = (id: string) => get<ManualMatchDto>(`/manual-matches/${encodeURIComponent(id)}`);
export const updateManualMatch = (id: string, input: ManualMatchInput) =>
  request<ManualMatchDto>('PUT', `/manual-matches/${encodeURIComponent(id)}`, input);
export const deleteManualMatch = (id: string) =>
  request<void>('DELETE', `/manual-matches/${encodeURIComponent(id)}`);
export const deleteAllManualMatches = () => request<void>('DELETE', '/manual-matches', { confirm: true });
export const importManualCsv = (req: ImportRequest) =>
  request<ImportResponse>('POST', '/manual-matches/import', req);
export const manualTemplateUrl = () => '/api/manual-matches/template.csv';
