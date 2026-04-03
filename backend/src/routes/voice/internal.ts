import type { FastifyInstance } from 'fastify';
import { authenticate } from '../../middleware/auth.js';
import { resolveTenantContext } from '../../middleware/tenantContext.js';
import { listCallsHandler, getCallHandler } from '../../modules/voice/controllers/internal/calls.controller.js';
import {
  getSessionHandler,
  setSessionFallbackHandler,
  setSessionHandoverHandler,
} from '../../modules/voice/controllers/internal/sessions.controller.js';
import { listEventsHandler } from '../../modules/voice/controllers/internal/events.controller.js';
import { listToolInvocationsHandler } from '../../modules/voice/controllers/internal/tools.controller.js';

const preHandler = [authenticate, resolveTenantContext];

/**
 * Internal voice routes — JWT-protected.
 * Used by the frontend and internal tooling to inspect voice data and trigger operations.
 */
export async function voiceInternalRoutes(app: FastifyInstance): Promise<void> {
  // ── Calls (C.2.1, C.2.2) ──────────────────────────────────────────────────
  app.get('/api/v1/voice/calls', { preHandler }, listCallsHandler);
  app.get<{ Params: { id: string } }>(
    '/api/v1/voice/calls/:id',
    { preHandler },
    getCallHandler,
  );

  // ── Sessions (C.2.3) ───────────────────────────────────────────────────────
  app.get<{ Params: { id: string } }>(
    '/api/v1/voice/sessions/:id',
    { preHandler },
    getSessionHandler,
  );

  // ── Events (C.2.4) ────────────────────────────────────────────────────────
  app.get<{ Params: { id: string } }>(
    '/api/v1/voice/calls/:id/events',
    { preHandler },
    listEventsHandler,
  );

  // ── Tool invocations (C.2.5) ──────────────────────────────────────────────
  app.get<{ Params: { id: string } }>(
    '/api/v1/voice/sessions/:id/tools',
    { preHandler },
    listToolInvocationsHandler,
  );

  // ── Session operations (C.3) ──────────────────────────────────────────────
  app.post<{ Params: { id: string } }>(
    '/api/v1/voice/sessions/:id/fallback',
    { preHandler },
    setSessionFallbackHandler,
  );

  app.post<{ Params: { id: string } }>(
    '/api/v1/voice/sessions/:id/handover',
    { preHandler },
    setSessionHandoverHandler,
  );
}