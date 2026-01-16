import type { NextFunction, Request, Response } from "express";

export type ErrorPayload = {
  code: string;
  message: string;
  status: number;
  details?: unknown;
};

export class AppError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(payload: ErrorPayload) {
    super(payload.message);
    this.status = payload.status;
    this.code = payload.code;
    this.details = payload.details;
  }
}

export function notFoundHandler(req: Request, res: Response, next: NextFunction) {
  next(
    new AppError({
      status: 404,
      code: "NOT_FOUND",
      message: "Resource not found",
      details: { path: req.path },
    })
  );
}

export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction
) {
  const isAppError = err instanceof AppError;
  const status = isAppError ? err.status : 500;
  const code = isAppError ? err.code : "INTERNAL_ERROR";
  const message = isAppError ? err.message : "Unexpected error";
  const details = isAppError ? err.details : undefined;
  const method = req.method;
  const path = req.originalUrl || req.path;

  if (isAppError) {
    console.error(`[${code}] ${method} ${path}`, { status, details });
  } else {
    console.error(`[UNEXPECTED_ERROR] ${method} ${path}`, err);
  }

  const payload = { error: { code, message, status, details } };
  if (req.accepts("json") && !req.accepts("html")) {
    res.status(status).json(payload);
    return;
  }
  res.status(status).send(`${code}: ${message}`);
}
