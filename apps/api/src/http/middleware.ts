import type { Request, RequestHandler, Response } from 'express';
import { getSessionUser, type Db, type UserRow } from '../db/index.js';
import { HttpError, log } from './errors.js';

export const SESSION_COOKIE = 'va_session';

export function securityHeaders(): RequestHandler {
  return (_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Frame-Options', 'DENY');
    // Strict CSP; the only HTML this API serves is the mock RSO page, which needs inline style and same-origin links.
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
    );
    res.setHeader('Cache-Control', 'no-store');
    next();
  };
}

/** Request log without query strings (they carry OAuth codes/state), cookies or headers. */
export function requestLogger(): RequestHandler {
  return (req, res, next) => {
    const t0 = Date.now();
    res.on('finish', () => {
      log('request', { method: req.method, path: req.path, status: res.statusCode, ms: Date.now() - t0 });
    });
    next();
  };
}

export function csrfGuard(): RequestHandler {
  return (req, _res, next) => {
    if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();
    if (req.get('x-requested-with') !== 'va-web') {
      return next(new HttpError(403, 'csrf', 'Missing or invalid X-Requested-With header.'));
    }
    next();
  };
}

export interface RateLimitOptions {
  max: number;
  windowMs?: number;
  group: string;
}

/** Tiny in-memory fixed-window limiter per IP + group. */
export function rateLimit(opts: RateLimitOptions): RequestHandler {
  const windowMs = opts.windowMs ?? 60_000;
  const hits = new Map<string, { count: number; resetAt: number }>();
  return (req, res, next) => {
    const now = Date.now();
    if (hits.size > 10_000) {
      for (const [k, v] of hits) if (v.resetAt <= now) hits.delete(k);
    }
    const key = `${req.ip ?? 'unknown'}|${opts.group}`;
    let entry = hits.get(key);
    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + windowMs };
      hits.set(key, entry);
    }
    entry.count++;
    if (entry.count > opts.max) {
      res.setHeader('Retry-After', String(Math.max(1, Math.ceil((entry.resetAt - now) / 1000))));
      return next(new HttpError(429, 'rate_limited', 'Too many requests. Try again shortly.'));
    }
    next();
  };
}

/** Resolves the session cookie to a user (or null) and stores both in res.locals. */
export function sessionLoader(db: Db): RequestHandler {
  return async (req, res, next) => {
    res.locals.user = null;
    res.locals.sessionToken = null;
    const token: unknown = req.cookies?.[SESSION_COOKIE];
    if (typeof token === 'string' && token.length > 0 && token.length <= 256) {
      res.locals.sessionToken = token;
      res.locals.user = await getSessionUser(db, token);
    }
    next();
  };
}

export const currentUser = (res: Response): UserRow | null => (res.locals.user as UserRow | null) ?? null;
export const currentToken = (res: Response): string | null => (res.locals.sessionToken as string | null) ?? null;

export const requireUser: RequestHandler = (_req, res, next) => {
  if (!currentUser(res)) return next(new HttpError(401, 'unauthenticated', 'Sign in to continue.'));
  next();
};

/** For handlers behind requireUser. */
export function userOf(res: Response): UserRow {
  const u = currentUser(res);
  if (!u) throw new HttpError(401, 'unauthenticated', 'Sign in to continue.');
  return u;
}

export type { Request };
