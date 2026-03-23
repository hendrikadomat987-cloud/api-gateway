# API Gateway — Architecture Specification

## Overview

A lightweight, production-ready HTTP API Gateway built with **Node.js + Express**.
It authenticates requests via **JWT (HS256)**, maps REST routes to **n8n webhook** endpoints, and forwards all traffic with enriched headers.

---

## Project Structure

```
api-gateway/
├── server.js                        # Entry point — Express app + server lifecycle
├── config.js                        # Centralised env-var config (all reads live here)
├── package.json
├── .env.example                     # Environment variable template
├── gateway-spec.md                  # This file
│
├── src/
│   ├── middleware/
│   │   ├── auth.js                  # JWT HS256 validation
│   │   ├── requestId.js             # Attach X-Request-ID to every request
│   │   ├── requestLogger.js         # Morgan HTTP access log via Winston
│   │   └── errorHandler.js          # 400/401/404/500 structured error responses
│   │
│   ├── routes/
│   │   └── apiRouter.js             # publicRouter + protectedRouter
│   │
│   ├── services/
│   │   └── serviceMap.js            # Service name → n8n webhook URL resolver
│   │
│   └── utils/
│       ├── forwardRequest.js        # Axios-based upstream proxy
│       └── logger.js                # Winston logger (pretty dev / JSON prod)
│
└── tests/
    └── smoke.js                     # No-framework smoke test
```

---

## Request Lifecycle

```
Client
  │
  ├─ POST /api/v1/customer
  │
  ▼
[requestId]          Attach / echo X-Request-ID header
  │
[requestLogger]      Morgan → Winston HTTP log
  │
[publicRouter]       /api/health, /api/services  ──► response (no auth)
  │
[authenticate]       Verify JWT (HS256)
  │  ├─ missing / malformed  ──► 401 MISSING_TOKEN / INVALID_TOKEN_FORMAT
  │  ├─ expired              ──► 401 TOKEN_EXPIRED
  │  └─ invalid signature    ──► 401 INVALID_TOKEN
  │
[protectedRouter]    /api/:version/:service/:id?
  │  ├─ bad version format   ──► 400 INVALID_VERSION
  │  └─ unknown service      ──► 404 SERVICE_NOT_FOUND
  │
[forwardRequest]     Axios → n8n webhook
  │  └─ network / timeout    ──► 502 UPSTREAM_ERROR
  │
[mirror response]    status + safe headers + body  ──► Client
```

---

## REST Routing

| Pattern                        | Description                          |
|-------------------------------|--------------------------------------|
| `GET  /api/:ver/:service`      | List / query collection              |
| `POST /api/:ver/:service`      | Create resource                      |
| `GET  /api/:ver/:service/:id`  | Get single resource                  |
| `PUT  /api/:ver/:service/:id`  | Full update                          |
| `PATCH /api/:ver/:service/:id` | Partial update                       |
| `DELETE /api/:ver/:service/:id`| Delete resource                      |

Version must match `/^v\d+$/` — e.g. `v1`, `v2`.
All HTTP methods are forwarded as-is to the upstream webhook.

---

## Service Registry

Defined in `config.js → services`.  Adding a new service requires only one line there.

| Service name   | n8n Webhook path        | Full URL (default)                               |
|---------------|-------------------------|--------------------------------------------------|
| `customer`    | `customer_service`      | `http://localhost:5678/webhook/customer_service`    |
| `appointment` | `appointment_service`   | `http://localhost:5678/webhook/appointment_service` |
| `availability`| `availability_service`  | `http://localhost:5678/webhook/availability_service`|
| `request`     | `request_service`       | `http://localhost:5678/webhook/request_service`     |

---

## Authentication

- **Algorithm:** HS256 only (RS256 / `alg: none` rejected at library level)
- **Header:** `Authorization: Bearer <token>`
- **Secret:** `JWT_SECRET` env var (≥ 32 characters recommended)
- **Optional checks:** `JWT_ISSUER`, `JWT_AUDIENCE`
- Decoded payload is attached to `req.jwtPayload` and forwarded downstream as:
  - `X-User-ID` — `payload.sub`
  - `X-User-Roles` — `JSON.stringify(payload.roles)`

---

## Headers Forwarded to n8n

| Header              | Value                                    |
|--------------------|------------------------------------------|
| `X-Request-ID`     | Unique request UUID                      |
| `X-Forwarded-For`  | Original client IP                       |
| `X-Gateway-Version`| `1.0`                                    |
| `X-Gateway-Token`  | `N8N_WEBHOOK_SECRET` (if set)            |
| `X-User-ID`        | JWT `sub` claim                          |
| `X-User-Roles`     | JWT `roles` claim (JSON array)           |
| `X-Gateway-Meta`   | JSON: `{ version, service, id, query }`  |

---

## Error Response Schema

All error responses follow a consistent shape:

```json
{
  "success": false,
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable description"
  }
}
```

| HTTP Status | Code                   | Cause                                  |
|------------|------------------------|----------------------------------------|
| 400        | `INVALID_VERSION`      | Version not matching `v\d+`            |
| 401        | `MISSING_TOKEN`        | No Authorization header                |
| 401        | `INVALID_TOKEN_FORMAT` | Not `Bearer <token>`                   |
| 401        | `TOKEN_EXPIRED`        | JWT `exp` in the past                  |
| 401        | `INVALID_TOKEN`        | Bad signature or malformed JWT         |
| 401        | `TOKEN_NOT_ACTIVE`     | JWT `nbf` in the future                |
| 404        | `SERVICE_NOT_FOUND`    | `:service` not in registry             |
| 404        | `NOT_FOUND`            | Route doesn't exist at all             |
| 500        | `INTERNAL_ERROR`       | Unhandled exception                    |
| 502        | `UPSTREAM_ERROR`       | n8n returned error / network failure   |

---

## Environment Variables

| Variable              | Required | Default               | Description                          |
|----------------------|----------|-----------------------|--------------------------------------|
| `JWT_SECRET`         | ✅       | —                     | HS256 signing secret (≥ 32 chars)    |
| `PORT`               | ❌       | `3000`                | HTTP listen port                     |
| `NODE_ENV`           | ❌       | `development`         | `development` / `production`         |
| `N8N_BASE_URL`       | ❌       | `http://localhost:5678` | n8n instance base URL              |
| `N8N_WEBHOOK_SECRET` | ❌       | —                     | Shared secret sent as X-Gateway-Token|
| `JWT_ISSUER`         | ❌       | —                     | Expected `iss` claim                 |
| `JWT_AUDIENCE`       | ❌       | —                     | Expected `aud` claim                 |
| `LOG_LEVEL`          | ❌       | `info`                | `error/warn/info/http/debug`         |
| `FORWARD_TIMEOUT_MS` | ❌       | `10000`               | Upstream request timeout (ms)        |

---

## Public Endpoints (no JWT)

| Method | Path           | Description                  |
|--------|---------------|------------------------------|
| GET    | `/ping`        | Liveness probe               |
| GET    | `/api/health`  | Health + registered services |
| GET    | `/api/services`| Full service registry list   |

---

## Logging

- **Library:** Winston
- **Development:** coloured single-line `HH:mm:ss [level] message {meta}`
- **Production:** structured JSON (one object per line, suitable for log aggregators)
- **HTTP access log:** Morgan piped through Winston at `http` level
- Every log entry for a request includes `requestId` for correlation

---

## Adding a New Service

1. Open `config.js`
2. Add one entry to the `services` object:
   ```js
   invoicing: 'invoicing_service',
   ```
3. Create the matching webhook in n8n at `/webhook/invoicing_service`
4. Restart the gateway — no other code changes needed

---

## Extending JWT Validation

To add role-based access control, edit `src/middleware/auth.js` after `req.jwtPayload = payload`:

```js
if (!payload.roles?.includes('api_user')) {
  return res.status(403).json(error('FORBIDDEN', 'Insufficient permissions'));
}
```

---

## Deployment Notes

- Runs on **Node ≥ 18**
- Handles `SIGTERM` / `SIGINT` for graceful shutdown (zero-downtime restarts)
- Stateless — safe to run multiple replicas behind a load balancer
- No persistent storage — all state lives in n8n downstream
