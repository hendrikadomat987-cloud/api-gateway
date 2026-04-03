import { AppError, NotFoundError } from '../errors/index.js';
import { isKnownService } from './serviceRegistry.js';
import { z } from 'zod';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const ISO_DATETIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;

function isIsoDateTime(value: string): boolean {
  return ISO_DATETIME_RE.test(value) && !Number.isNaN(Date.parse(value));
}

function isValidDateOnly(value: string): boolean {
  const m = /^\d{4}-\d{2}-\d{2}$/.exec(value);
  if (!m) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

function isValidTimezone(value: string): boolean {
  try {
    Intl.DateTimeFormat(undefined, { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

const baseEngineSchema = z.object({
  customer_id: z.string().uuid(),
  duration_minutes: z.number().int().positive().optional(),
  timezone: z.string().optional(),
});

const slotsSchema = baseEngineSchema.extend({
  from: z.string(),
  to: z.string(),
});

const checkSchema = baseEngineSchema.extend({
  start: z.string(),
});

const nextFreeSchema = baseEngineSchema.extend({
  after: z.string(),
});

const dayViewSchema = baseEngineSchema.extend({
  date: z.string(),
});

export function isValidUuid(value: string): boolean {
  return UUID_RE.test(value);
}

export function assertValidVersion(version: string): void {
  if (version !== 'v1') {
    throw new AppError(400, 'INVALID_VERSION', `Unsupported API version: ${version}`);
  }
}

export function assertKnownService(service: string): void {
  if (!isKnownService(service)) {
    throw new NotFoundError(`Unknown service: ${service}`, 'SERVICE_NOT_FOUND');
  }
}

export function assertValidId(id: string): void {
  if (!isValidUuid(id)) {
    throw new AppError(400, 'INVALID_ID', `Invalid ID format: ${id}`);
  }
}

export function assertIdPresent(id: string | undefined): void {
  if (!id) {
    throw new AppError(400, 'MISSING_ID', 'Resource ID is required for this method');
  }
}

function ensureObjectBody(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Request body must be a JSON object');
  }
  return body as Record<string, unknown>;
}

function assertTimezoneIfPresent(body: Record<string, unknown>): void {
  if (body.timezone !== undefined) {
    if (typeof body.timezone !== 'string' || !isValidTimezone(body.timezone)) {
      throw new AppError(400, 'VALIDATION_ERROR', 'Invalid timezone');
    }
  }
}

export function assertValidAvailabilityEngineRequest(
  operation: string,
  body: unknown,
): void {
  const payload = ensureObjectBody(body);

  let parsed: z.infer<typeof slotsSchema | typeof checkSchema | typeof nextFreeSchema | typeof dayViewSchema>;

  switch (operation) {
    case 'slots': {
      const result = slotsSchema.safeParse(payload);
      if (!result.success) {
        throw new AppError(400, 'VALIDATION_ERROR', 'Invalid slots request body');
      }
      parsed = result.data;
      if (!isIsoDateTime(parsed.from)) {
        throw new AppError(400, 'VALIDATION_ERROR', 'Invalid from datetime');
      }
      if (!isIsoDateTime(parsed.to)) {
        throw new AppError(400, 'VALIDATION_ERROR', 'Invalid to datetime');
      }
      if (Date.parse(parsed.from) >= Date.parse(parsed.to)) {
        throw new AppError(400, 'VALIDATION_ERROR', '`from` must be before `to`');
      }
      assertTimezoneIfPresent(payload);
      return;
    }

    case 'check': {
      const result = checkSchema.safeParse(payload);
      if (!result.success) {
        throw new AppError(400, 'VALIDATION_ERROR', 'Invalid check request body');
      }
      parsed = result.data;
      if (!isIsoDateTime(parsed.start)) {
        throw new AppError(400, 'VALIDATION_ERROR', 'Invalid start datetime');
      }
      assertTimezoneIfPresent(payload);
      return;
    }

    case 'next-free': {
      const result = nextFreeSchema.safeParse(payload);
      if (!result.success) {
        throw new AppError(400, 'VALIDATION_ERROR', 'Invalid next-free request body');
      }
      parsed = result.data;
      if (!isIsoDateTime(parsed.after)) {
        throw new AppError(400, 'VALIDATION_ERROR', 'Invalid after datetime');
      }
      assertTimezoneIfPresent(payload);
      return;
    }

    case 'day-view': {
      const result = dayViewSchema.safeParse(payload);
      if (!result.success) {
        throw new AppError(400, 'VALIDATION_ERROR', 'Invalid day-view request body');
      }
      parsed = result.data;
      if (!isValidDateOnly(parsed.date)) {
        throw new AppError(400, 'VALIDATION_ERROR', 'Invalid date');
      }
      assertTimezoneIfPresent(payload);
      return;
    }

    default:
      throw new AppError(404, 'SERVICE_NOT_FOUND', `Unknown availability-engine operation: ${operation}`);
  }
}