import Fastify from 'fastify';
import fastifyJwt from '@fastify/jwt';
import type { FastifyBaseLogger } from 'fastify';
import type { Config } from './config/env.js';
import type { Logger } from 'pino';
import { errorHandler } from './errors/index.js';
import { requestContextPlugin } from './plugins/requestContext.js';
import { pingRoutes } from './routes/ping.js';
import { healthRoutes } from './routes/health.js';
import { apiRoutes } from './routes/api.js';
import { voicePublicRoutes } from './routes/voice/public.js';
import { voiceInternalRoutes } from './routes/voice/internal.js';
import { voiceToolsBookingRoutes } from './routes/voice/tools-booking.js';
import { voiceToolsRestaurantRoutes } from './routes/voice/tools-restaurant.js';
import { featureRoutes } from './routes/features.js';
import { featuresInternalRoutes } from './routes/features-internal.js';
import { plansInternalRoutes } from './routes/plans-internal.js';
import { usageRoutes } from './routes/usage.js';

export interface BuildAppOptions {
  config: Config;
  logger: Logger;
}

export async function buildApp(opts: BuildAppOptions) {
  const { config, logger } = opts;

const app = Fastify({
  loggerInstance: logger,
  // Let requestContextPlugin manage IDs; disable Fastify's auto-counter
  genReqId: () => '',
  trustProxy: true,
  ajv: {
    customOptions: {
      coerceTypes: false,
      allErrors: false,
    },
  },
});

  // ── Plugins ────────────────────────────────────────────────────────────────

  await app.register(requestContextPlugin);

  await app.register(fastifyJwt, {
    secret: config.JWT_SECRET,
    decode: { complete: true },
    verify: {
      ...(config.JWT_ISSUER   && { allowedIss: config.JWT_ISSUER }),
      ...(config.JWT_AUDIENCE && { allowedAud: config.JWT_AUDIENCE }),
    },
  });

  // ── JSON body parser — tolerate empty bodies ──────────────────────────────
  //
  // Fastify v5 classifies DELETE (and OPTIONS) as "bodywith" methods: it tries
  // to parse the body whenever Content-Type: application/json is present.
  // REST clients — including our test suite — routinely send that header even
  // on bodyless DELETE requests.  Fastify's built-in parser throws
  // FST_ERR_CTP_EMPTY_JSON_BODY *before* preHandlers run, so auth middleware
  // never executes and every unauthenticated DELETE comes back as 400 instead
  // of 401, and every DELETE with an invalid UUID returns VALIDATION_ERROR
  // instead of INVALID_ID.
  //
  // Overriding the parser to return {} for empty bodies lets the request
  // proceed through the normal auth → validation → dispatch lifecycle.
  app.addContentTypeParser(
    'application/json',
    { parseAs: 'string' },
    (_req, body, done) => {
      if (!body || (body as string).length === 0) {
        done(null, {});
        return;
      }
      try {
        done(null, JSON.parse(body as string));
      } catch {
        // Attach statusCode so the global error handler maps it to VALIDATION_ERROR
        const err = Object.assign(
          new Error('Invalid JSON in request body'),
          { statusCode: 400 },
        );
        done(err);
      }
    },
  );

  // ── Global error handler ───────────────────────────────────────────────────

  app.setErrorHandler((error, request, reply) => {
  return errorHandler(error as any, request as any, reply as any);
});

  // ── Routes ─────────────────────────────────────────────────────────────────

  await app.register(pingRoutes);
  await app.register(healthRoutes);
  await app.register(apiRoutes, { config });

  // ── Voice routes ───────────────────────────────────────────────────────────
  await app.register(voicePublicRoutes, { config });
  await app.register(voiceInternalRoutes);
  await app.register(voiceToolsBookingRoutes);
  await app.register(voiceToolsRestaurantRoutes);

  // ── Feature routes ─────────────────────────────────────────────────────────
  await app.register(featureRoutes);
  await app.register(featuresInternalRoutes);
  await app.register(plansInternalRoutes);
  await app.register(usageRoutes);

  // 404 fallback
  app.setNotFoundHandler((_request, reply) => {
    reply.status(404).send({
      success: false,
      error: { code: 'NOT_FOUND', message: 'Route not found' },
    });
  });

  return app;
}
