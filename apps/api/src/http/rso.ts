export interface RsoProvider {
  /** URL the browser is sent to for sign-on. */
  authorizeUrl(state: string): string;
  /** Exchange an authorization code for an access token. The token must be used only transiently. */
  exchangeCode(code: string): Promise<{ accessToken: string }>;
}

/** Demo provider: the "authorize" page is served by this app (see routes); the code is the fixture access token. */
export class MockRsoProvider implements RsoProvider {
  authorizeUrl(state: string): string {
    return `/api/riot/mock-authorize?state=${encodeURIComponent(state)}`;
  }
  async exchangeCode(code: string): Promise<{ accessToken: string }> {
    return { accessToken: code };
  }
}

export interface RiotRsoOptions {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export class RiotRsoProvider implements RsoProvider {
  private readonly fetchImpl: typeof fetch;
  constructor(private readonly opts: RiotRsoOptions) {
    this.fetchImpl = opts.fetchImpl ?? ((...args) => fetch(...args));
  }

  authorizeUrl(state: string): string {
    const q = new URLSearchParams({
      client_id: this.opts.clientId,
      redirect_uri: this.opts.redirectUri,
      response_type: 'code',
      scope: 'openid',
      state,
    });
    return `https://auth.riotgames.com/authorize?${q.toString()}`;
  }

  async exchangeCode(code: string): Promise<{ accessToken: string }> {
    const basic = Buffer.from(`${this.opts.clientId}:${this.opts.clientSecret}`).toString('base64');
    const res = await this.fetchImpl('https://auth.riotgames.com/token', {
      method: 'POST',
      headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: this.opts.redirectUri,
      }).toString(),
      signal: AbortSignal.timeout(this.opts.timeoutMs ?? 10_000),
    });
    // Never include the response body or credentials in errors.
    if (!res.ok) throw new Error(`RSO token exchange failed (${res.status})`);
    const json = (await res.json()) as { access_token?: unknown };
    if (typeof json.access_token !== 'string' || json.access_token === '') throw new Error('RSO token response missing access_token');
    return { accessToken: json.access_token };
  }
}
