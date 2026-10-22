import cookieParser from 'cookie-parser';
import express from 'express';
import type { Db } from './db/index.js';
import type { SyncQueue } from './ingestion/index.js';
import type { RiotClient } from './riot/index.js';
import type { Env } from './env.js';
import { errorHandler, notFoundHandler } from './http/errors.js';
import { csrfGuard, requestLogger, securityHeaders, sessionLoader } from './http/middleware.js';
import { createApiRouter } from './http/routes.js';
import type { RsoProvider } from './http/rso.js';

export interface AppDeps {
  db: Db;
  riot: RiotClient;
  rso: RsoProvider;
  queue: SyncQueue;
  env: Env;
}

export function createApp(deps: AppDeps): express.Express {
  const app = express();
  app.disable('x-powered-by');
  app.use(securityHeaders());
  app.use(requestLogger());

  const api = express.Router();
  api.use(express.json({ limit: '16kb' }));
  api.use(cookieParser());
  api.use(csrfGuard());
  api.use(sessionLoader(deps.db));
  api.use(createApiRouter(deps));
  api.use(notFoundHandler);

  app.use('/api', api);
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
