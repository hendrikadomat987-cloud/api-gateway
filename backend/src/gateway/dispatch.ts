import type { FastifyBaseLogger } from 'fastify';
import type { ServiceName } from './serviceRegistry.js';
import type { GatewayMethod } from './serviceMap.js';
import { resolveWebhookPath } from './serviceMap.js';
import { AppError, UpstreamClientError } from '../errors/index.js';
import {
  normalizeEmptyResponse,
  normalizeRawTextResponse,
  classifyUpstreamStatus,
} from './compatibility.js';
import { OPERATION_SERVICES } from './serviceRegistry.js';

export interface DispatchParams {
  service:   ServiceName;
  method:    string;
  tenantId:  string;
  userId?:   string;
  id?:       string;
  payload:   Record<string, unknown>;
  requestId: string;
}

export interface DispatcherConfig {
  N8N_BASE_URL:        string;
  N8N_WEBHOOK_SECRET?: string;
  FORWARD_TIMEOUT_MS:  number;
}

// ── Safe header construction ──────────────────────────────────────────────────

function buildForwardHeaders(
  params: DispatchParams,
  config: DispatcherConfig,
): Record<string, string> {
  const headers: Record<string, string> = {
    'content-type':      'application/json',
    'x-request-id':      params.requestId,
    'x-tenant-id':       params.tenantId,   // always from JWT — never from client input
    'x-gateway-version': 'v1',
  };
  if (params.userId)              headers['x-user-id']       = params.userId;
  if (config.N8N_WEBHOOK_SECRET)  headers['x-gateway-token'] = config.N8N_WEBHOOK_SECRET;
  return headers;
}

// ── URL construction ──────────────────────────────────────────────────────────

function buildTargetUrl(
  baseUrl: string,
  webhookPath: string,
  id: string | undefined,
  method: string,
): string {
  const url = new URL(`${baseUrl}/webhook/${webhookPath}`);
  // id is always forwarded as a query param — n8n workflows read it from query regardless of method.
  // This matches the Express gateway behaviour where extraMeta.id is appended to queryParams.
  if (id) {
    url.searchParams.set('id', id);
  }
  return url.toString();
}

// ── Body construction ─────────────────────────────────────────────────────────

function buildForwardBody(
  payload: Record<string, unknown>,
  id: string | undefined,
  method: string,
): string | undefined {
  if (method === 'GET' || method === 'DELETE') return undefined;
  return JSON.stringify(id ? { ...payload, id } : payload);
}

// ── Main dispatch function ────────────────────────────────────────────────────

export async function dispatchToWorkflow(
  params: DispatchParams,
  log: FastifyBaseLogger,
  config: DispatcherConfig,
): Promise<unknown> {
  const { service, method, tenantId, id, payload, requestId } = params;

  // For operation-style services (e.g. availability-engine), the :id segment is an
  // operation name (slots/check/next-free/day-view), not a resource UUID.
  // Route directly to {service}/{operation} and do NOT merge the operation name into the body.
  let webhookPath: string;
  let forwardId: string | undefined = id;
  if (OPERATION_SERVICES.has(service) && method === 'POST' && id) {
    webhookPath = `${service}/${id}`;
    forwardId   = undefined;
  } else {
    webhookPath = resolveWebhookPath(service, method as GatewayMethod, id !== undefined);
  }

  const targetUrl = buildTargetUrl(config.N8N_BASE_URL, webhookPath, forwardId, method);
  const headers   = buildForwardHeaders(params, config);
  const body      = buildForwardBody(payload, forwardId, method);

  log.info(
    { service, method, webhookPath, requestId, tenantId },
    'dispatching to n8n',
  );

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.FORWARD_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(targetUrl, { method, headers, body, signal: controller.signal });
  } catch (err: unknown) {
    clearTimeout(timer);
    if (err instanceof Error && err.name === 'AbortError') {
      log.warn({ requestId, service, method }, 'upstream timeout');
      throw new AppError(504, 'UPSTREAM_TIMEOUT', 'Upstream request timed out');
    }
    log.error({ err, requestId, service, method }, 'upstream network error');
    throw new AppError(502, 'UPSTREAM_ERROR', 'Upstream service unavailable');
  }
  clearTimeout(timer);

  // ── Parse upstream body ─────────────────────────────────────────────────────

  const text = await response.text();
  let responseBody: unknown;

  if (!text.trim()) {
    responseBody = normalizeEmptyResponse();
  } else {
    try {
      responseBody = JSON.parse(text);
    } catch {
      // Non-JSON or malformed body — normalize safely; do not surface raw content
      log.warn({ requestId, service, method, status: response.status }, 'upstream returned non-JSON body');
      responseBody = normalizeRawTextResponse(text);
    }
  }

  // ── Upstream error handling ─────────────────────────────────────────────────

  if (!response.ok) {
    if (response.status >= 500) {
      // Mask upstream 5xx — never expose internal details to the client.
      log.warn({ status: response.status, requestId, service, method }, 'upstream returned server error');
      throw new AppError(502, 'UPSTREAM_ERROR', 'Upstream service returned an error');
    }
    // 4xx: forward the upstream body verbatim so error codes (VALIDATION_ERROR etc.) are
    // preserved and client-facing error contracts remain stable.
    log.warn({ status: response.status, requestId, service, method }, 'upstream returned client error');
    throw new UpstreamClientError(response.status, responseBody);
  }

  return responseBody;
}
