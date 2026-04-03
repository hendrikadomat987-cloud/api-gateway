/**
 * Removes `tenant_id` from the request body before it is forwarded downstream.
 *
 * Prevents callers from overriding tenant context via the payload.
 * tenantId is always derived from the verified JWT (see tenantContext middleware).
 */
export function sanitizeBody(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return {};
  }
  // Destructure out tenant_id; forward everything else
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { tenant_id: _removed, ...clean } = body as Record<string, unknown>;
  return clean;
}
