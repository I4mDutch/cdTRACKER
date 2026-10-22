import type { ErrorRequestHandler, RequestHandler } from 'express';
import type { ApiError } from '@va/shared';

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export const log = (event: string, fields: Record<string, unknown> = {}): void => {
  console.log(JSON.stringify({ ts: new Date().toISOString(), event, ...fields }));
};

export const notFoundHandler: RequestHandler = (_req, _res, next) => {
  next(new HttpError(404, 'not_found', 'Not found.'));
};

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  let status = 500;
  let code = 'internal';
  let message = 'Something went wrong. Try again later.';
  if (err instanceof HttpError) {
    status = err.status;
    code = err.code;
    message = err.message;
  } else if (typeof err === 'object' && err !== null) {
    const e = err as { type?: string; status?: number };
    if (e.type === 'entity.parse.failed') {
      status = 400;
      code = 'validation';
      message = 'Request body is not valid JSON.';
    } else if (e.type === 'entity.too.large') {
      status = 413;
      code = 'validation';
      message = 'Request body is too large.';
    }
  }
  if (status >= 500) {
    // Log the error class only: messages from the DB layer can contain SQL.
    log('request_error', { error: err instanceof Error ? err.name : typeof err });
  }
  if (res.headersSent) {
    res.end();
    return;
  }
  const body: ApiError = { error: { code, message } };
  res.status(status).json(body);
};
