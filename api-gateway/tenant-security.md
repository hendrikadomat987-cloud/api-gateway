# Tenant Security Architecture

## Overview

This system uses JWT-based tenant isolation.

The tenant is identified by:

organization_id inside the JWT payload.

---

## Rules

1. The tenant MUST always come from JWT

2. The following is NOT trusted:
   - x-tenant-id header
   - request body tenant_id
   - query params

3. If a tenant header is present:
   - it must match the JWT
   - otherwise the request is rejected (403)

---

## Request Lifecycle

Client Request
→ JWT Authentication
→ Tenant Context Middleware
→ Business Logic

---

## Result

Every request contains:

req.tenant_id

This value is trusted and must be used for:

- Database queries
- Workflow execution
- Service routing

---

## Future Architecture

The system will evolve into:

Client
→ Tenant Core Backend
→ n8n
→ Database

The tenant context will later be enforced via:

SET LOCAL app.current_tenant

---

## Important

n8n must never determine tenant identity.

Tenant identity must always come from the backend layer.
