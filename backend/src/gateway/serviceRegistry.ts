/**
 * Central service registry — single source of truth for all allowed services.
 * Add a service name here to make it routable; removing it auto-rejects it.
 */

export const SERVICES = [
  'customer',
  'appointments',
  'requests',
  'resources',
  'availability',
  'notifications',
  'status',
  'knowledge',
  // Availability-engine — POST-only calculation service.
  // Uses operation-name sub-paths (slots/check/next-free/day-view) instead of UUID ids.
  'availability-engine',
  // Availability-engine seed/test infrastructure — POST + DELETE_ID only.
  'availability-exceptions',
  'availability-blocks',
  'resource-working-hours',
] as const;

export type ServiceName = (typeof SERVICES)[number];

/** Type-guard: true iff `service` is a registered ServiceName. */
export function isKnownService(service: string): service is ServiceName {
  return (SERVICES as readonly string[]).includes(service);
}

/**
 * Services that use an operation name as the URL sub-path rather than a resource UUID.
 * For these services, the :id segment is an operation key (e.g. 'slots'), not a UUID,
 * and UUID validation is intentionally skipped.
 */
export const OPERATION_SERVICES = new Set<string>(['availability-engine']);
