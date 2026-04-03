import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';

// ── Error classes ─────────────────────────────────────────────────────────────

export class AppError extends Error {
  public readonly statusCode: number;
  public readonly code: string;
  public readonly details?: unknown;

  constructor(statusCode: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

export class AuthError extends AppError {
  constructor(message = 'Unauthorized', code = 'UNAUTHORIZED') {
    super(401, code, message);
    this.name = 'AuthError';
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'Forbidden', code = 'FORBIDDEN') {
    super(403, code, message);
    this.name = 'ForbiddenError';
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'Not Found', code = 'NOT_FOUND') {
    super(404, code, message);
    this.name = 'NotFoundError';
  }
}

export class ValidationError extends AppError {
  constructor(message: string, details?: unknown) {
    super(400, 'VALIDATION_ERROR', message, details);
    this.name = 'ValidationError';
  }
}

/**
 * Carries a 4xx upstream response body so the error handler can forward it
 * to the client verbatim, preserving the upstream error code (e.g. VALIDATION_ERROR).
 */
export class UpstreamClientError extends AppError {
  readonly upstreamBody: unknown;
  constructor(statusCode: number, body: unknown) {
    super(statusCode, 'UPSTREAM_CLIENT_ERROR', 'Upstream returned a client error');
    this.name = 'UpstreamClientError';
    this.upstreamBody = body;
  }
}

// ── Response shape ────────────────────────────────────────────────────────────

interface ErrorResponse {
  success: false;
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
  requestId: string;
}

// ── Global error handler ──────────────────────────────────────────────────────

export function errorHandler(
  error: FastifyError | AppError | Error,
  request: FastifyRequest,
  reply: FastifyReply,
): void {
  const requestId = request.id as string;

  // Upstream 4xx — forward the upstream body verbatim (preserves VALIDATION_ERROR etc.)
  if (error instanceof UpstreamClientError) {
    reply.status(error.statusCode).send(error.upstreamBody);
    return;
  }

  // Known AppError
  if (error instanceof AppError) {
    const body: ErrorResponse = {
      success: false,
      error: { code: error.code, message: error.message, details: error.details },
      requestId,
    };
    reply.status(error.statusCode).send(body);
    return;
  }

  // Fastify validation error (statusCode 400)
  const fastifyError = error as FastifyError;
  if (fastifyError.statusCode === 400) {
    const body: ErrorResponse = {
      success: false,
      error: { code: 'VALIDATION_ERROR', message: fastifyError.message },
      requestId,
    };
    reply.status(400).send(body);
    return;
  }

  // Fastify JWT errors arrive as FastifyError with statusCode 401
  if (fastifyError.statusCode === 401) {
    const body: ErrorResponse = {
      success: false,
      error: { code: 'UNAUTHORIZED', message: 'Unauthorized' },
      requestId,
    };
    reply.status(401).send(body);
    return;
  }

  // Unhandled — log and return 500
  request.log.error({ err: error }, 'Unhandled error');
  const body: ErrorResponse = {
    success: false,
    error: { code: 'INTERNAL_ERROR', message: 'Internal Server Error' },
    requestId,
  };
  reply.status(500).send(body);
}
