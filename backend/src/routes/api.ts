import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { AppError } from '../errors/index.js';
import { authenticate } from '../middleware/auth.js';
import { resolveTenantContext } from '../middleware/tenantContext.js';
import { assertValidVersion, assertKnownService, assertValidId, assertValidAvailabilityEngineRequest } from '../gateway/validation.js';
import { sanitizeBody } from '../gateway/sanitize.js';
import { dispatchToWorkflow } from '../gateway/dispatch.js';
import type { ServiceName } from '../gateway/serviceRegistry.js';
import { OPERATION_SERVICES } from '../gateway/serviceRegistry.js';
import type { DispatcherConfig } from '../gateway/dispatch.js';

interface RouteParams {
  version: string;
  service: string;
  id?:     string;
}

const preHandler = [authenticate, resolveTenantContext];

export async function apiRoutes(
  app: FastifyInstance,
  opts: { config: DispatcherConfig },
): Promise<void> {
  const { config } = opts;

  async function apiHandler(
    request: FastifyRequest<{ Params: RouteParams }>,
    reply: FastifyReply,
  ): Promise<void> {
    const { version, service, id } = request.params;
    const method = request.method.toUpperCase();

    // 1. Validate version
    assertValidVersion(version);

    // 2. Validate service
    assertKnownService(service);

    // 3. Validate id when present.
    // Operation-style services use an operation name (e.g. 'slots') as the sub-path
    // rather than a UUID — skip UUID validation for those services.
    if (id !== undefined && !OPERATION_SERVICES.has(service)) {
      assertValidId(id);
    }

    // 4. Sanitize body — strip tenant_id regardless of origin
    const payload = sanitizeBody(request.body);

    // 4.1 Availability-engine operation/body validation
    if (service === 'availability-engine') {
      // Only POST is allowed for availability-engine operations
      if (method !== 'POST') {
         throw new AppError(405, 'METHOD_NOT_ALLOWED', 'Only POST allowed for availability-engine');
      }

      if (!id) {
        throw new AppError(400, 'MISSING_ID', 'Availability-engine operation is required');
      }

      assertValidAvailabilityEngineRequest(id, payload);
    }

    // 5. tenantId strictly from JWT (set by resolveTenantContext)
    const { tenantId } = request;
    const userId = request.user?.sub;

    // 6. Dispatch to n8n
    const result = await dispatchToWorkflow(
      {
        service:   service as ServiceName,
        method,
        tenantId,
        userId,
        id,
        payload,
        requestId: request.id as string,
      },
      request.log,
      config,
    );

    reply.send(result);
  }

  // Collection routes — no id (GET list, POST create)
  app.route({
    method: ['GET', 'POST'],
    url: '/api/:version/:service',
    preHandler,
    handler: apiHandler,
  });

  // Resource routes — id required (GET one, PATCH, DELETE).
  // POST is also included here for operation-style services (e.g. POST /availability-engine/slots)
  // where the second path segment is an operation name rather than a resource UUID.
  app.route({
    method: ['GET', 'POST', 'PATCH', 'DELETE'],
    url: '/api/:version/:service/:id',
    preHandler,
    handler: apiHandler,
  });

  // Explicit catch: PATCH / DELETE sent without id → clear MISSING_ID error
  app.route({
    method: ['PATCH', 'DELETE'],
    url: '/api/:version/:service',
    preHandler,
    handler: async (_request, _reply) => {
      throw new AppError(400, 'MISSING_ID', 'Resource ID is required for this method');
    },
  });
}
