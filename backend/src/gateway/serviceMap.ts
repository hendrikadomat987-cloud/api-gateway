import { AppError } from '../errors/index.js';
import type { ServiceName } from './serviceRegistry.js';

/** Subset of HTTP methods used by this gateway. */
export type GatewayMethod = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

type RouteKey = GatewayMethod | `${GatewayMethod}_ID`;

type ServiceRouteMap = Partial<Record<RouteKey, string>>;

/**
 * Maps (service, method, hasId) to a concrete n8n webhook path.
 *
 * Mirrors the existing API Gateway service registry so the n8n workflows
 * receive requests on the same paths they already handle.
 *
 * Naming convention: <service>/<operation>
 */
const SERVICE_MAP: Record<ServiceName, ServiceRouteMap> = {
  customer: {
    POST:       'customer/create',
    GET:        'customer/get',
    GET_ID:     'customer/get',
    PATCH_ID:   'customer/update',
    PUT_ID:     'customer/update',
    DELETE_ID:  'customer/delete',
  },
  appointments: {
    POST:       'appointments/create',
    GET:        'appointments/list',
    GET_ID:     'appointments/get',
    PATCH_ID:   'appointments/update',
    PUT_ID:     'appointments/update',
    DELETE_ID:  'appointments/delete',
  },
  requests: {
    POST:       'requests/create',
    GET:        'requests/list',
    GET_ID:     'requests/get',
    PATCH_ID:   'requests/update',
    PUT_ID:     'requests/update',
    DELETE_ID:  'requests/delete',
  },
  resources: {
    POST:       'resources/create',
    GET:        'resources/list',
    GET_ID:     'resources/get',
    PATCH_ID:   'resources/update',
    PUT_ID:     'resources/update',
    DELETE_ID:  'resources/delete',
  },
  availability: {
    POST:       'availability/create',
    GET:        'availability/list',
    GET_ID:     'availability/get',
    PATCH_ID:   'availability/update',
    PUT_ID:     'availability/update',
    DELETE_ID:  'availability/delete',
  },
  notifications: {
    POST:       'notifications/create',
    GET:        'notifications/list',
    GET_ID:     'notifications/get',
    PATCH_ID:   'notifications/update',
    PUT_ID:     'notifications/update',
    DELETE_ID:  'notifications/delete',
  },
  status: {
    POST:       'status/create',
    GET:        'status/list',
    GET_ID:     'status/get',
    PATCH_ID:   'status/update',
    PUT_ID:     'status/update',
    DELETE_ID:  'status/delete',
  },
  knowledge: {
    POST:       'knowledge/create',
    GET:        'knowledge/list',
    GET_ID:     'knowledge/get',
    PATCH_ID:   'knowledge/update',
    PUT_ID:     'knowledge/update',
    DELETE_ID:  'knowledge/delete',
  },

  // Availability-engine — operation routes (slots/check/next-free/day-view) are dispatched
  // dynamically in dispatch.ts using {service}/{operation} as the webhook path.
  // An empty map here ensures any unsupported method (GET, PATCH, DELETE) returns 405.
  'availability-engine': {},

  // Availability-engine seed infrastructure — POST create + DELETE by id only.
  'availability-exceptions': {
    POST:       'availability-exceptions/create',
    DELETE_ID:  'availability-exceptions/delete',
  },
  'availability-blocks': {
    POST:       'availability-blocks/create',
    DELETE_ID:  'availability-blocks/delete',
  },
  'resource-working-hours': {
    POST:       'resource-working-hours/create',
    DELETE_ID:  'resource-working-hours/delete',
  },
};

/**
 * Resolves the n8n webhook path for a (service, method, hasId) combination.
 * Throws 405 for unsupported combinations.
 */
export function resolveWebhookPath(
  service: ServiceName,
  method: GatewayMethod,
  hasId: boolean,
): string {
  const key: RouteKey = hasId ? `${method}_ID` : method;
  const path = SERVICE_MAP[service][key];
  if (!path) {
    throw new AppError(
      405,
      'METHOD_NOT_ALLOWED',
      `${method} ${hasId ? 'with id' : 'without id'} is not supported for service '${service}'`,
    );
  }
  return path;
}
