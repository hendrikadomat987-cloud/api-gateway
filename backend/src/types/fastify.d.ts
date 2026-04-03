import '@fastify/jwt';

/** Shape of the JWT payload used by this platform. */
export interface JwtPayload {
  sub: string;
  organization_id: string;
  role: string;
  aud?: string | string[];
  iss?: string;
  iat?: number;
  exp?: number;
}

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: JwtPayload;
    user: JwtPayload;
  }
}

declare module 'fastify' {
  interface FastifyRequest {
    /** Tenant ID derived from JWT organization_id — never from client input. */
    tenantId: string;
  }
}
