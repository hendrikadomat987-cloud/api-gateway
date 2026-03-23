# API Gateway — Setup & Usage

## Prerequisites

- Node.js ≥ 18
- n8n running (local or remote)

---

## 1. Install

```bash
cd api-gateway
npm install
```

---

## 2. Configure

```bash
cp .env.example .env
```

Edit `.env` — the only required change:

```env
JWT_SECRET=replace-with-a-strong-random-secret-at-least-32-chars
N8N_BASE_URL=http://localhost:5678
```

---

## 3. Run

```bash
# Development (auto-restart on file changes)
npm run dev

# Production
npm start
```

Expected output:
```
12:00:00 [info] API Gateway started {"port":3000,"env":"development","n8n":"http://localhost:5678"}
```

---

## 4. Smoke Test

With the server running:

```bash
npm test
```

---

## 5. Generate a JWT for Testing

```bash
node -e "
const jwt = require('jsonwebtoken');
const token = jwt.sign(
  { sub: 'user-123', roles: ['admin'] },
  process.env.JWT_SECRET || 'your-secret-here',
  { algorithm: 'HS256', expiresIn: '1h' }
);
console.log(token);
"
```

Or use [jwt.io](https://jwt.io) with algorithm HS256 and your secret.

---

## 6. Curl Examples

Replace `$TOKEN` with the JWT from step 5.

### Public endpoints (no auth)

```bash
# Liveness probe
curl http://localhost:3000/ping

# Health check
curl http://localhost:3000/api/health

# List registered services
curl http://localhost:3000/api/services
```

### Protected endpoints

```bash
TOKEN="eyJhbGci..."   # paste your JWT here

# ── Customer service ──────────────────────────────────────────────────────

# List customers
curl -H "Authorization: Bearer $TOKEN" \
     http://localhost:3000/api/v1/customer

# Get single customer
curl -H "Authorization: Bearer $TOKEN" \
     http://localhost:3000/api/v1/customer/42

# Create customer
curl -X POST \
     -H "Authorization: Bearer $TOKEN" \
     -H "Content-Type: application/json" \
     -d '{"name":"Jane Doe","email":"jane@example.com"}' \
     http://localhost:3000/api/v1/customer

# Update customer
curl -X PATCH \
     -H "Authorization: Bearer $TOKEN" \
     -H "Content-Type: application/json" \
     -d '{"email":"jane.new@example.com"}' \
     http://localhost:3000/api/v1/customer/42

# Delete customer
curl -X DELETE \
     -H "Authorization: Bearer $TOKEN" \
     http://localhost:3000/api/v1/customer/42

# ── Appointment service ───────────────────────────────────────────────────

# List appointments (with query param)
curl -H "Authorization: Bearer $TOKEN" \
     "http://localhost:3000/api/v1/appointment?date=2026-03-20"

# Book appointment
curl -X POST \
     -H "Authorization: Bearer $TOKEN" \
     -H "Content-Type: application/json" \
     -d '{"customerId":"42","slot":"2026-03-20T10:00:00Z"}' \
     http://localhost:3000/api/v1/appointment

# Get appointment by ID
curl -H "Authorization: Bearer $TOKEN" \
     http://localhost:3000/api/v1/appointment/99

# ── Availability service ──────────────────────────────────────────────────

curl -H "Authorization: Bearer $TOKEN" \
     "http://localhost:3000/api/v1/availability?date=2026-03-20"

# ── Request service ───────────────────────────────────────────────────────

# Submit a new request
curl -X POST \
     -H "Authorization: Bearer $TOKEN" \
     -H "Content-Type: application/json" \
     -d '{"type":"callback","message":"Please call me back"}' \
     http://localhost:3000/api/v1/request

# Get request status
curl -H "Authorization: Bearer $TOKEN" \
     http://localhost:3000/api/v1/request/7

# ── Error cases ───────────────────────────────────────────────────────────

# 401 — no token
curl -v http://localhost:3000/api/v1/customer

# 401 — bad token
curl -H "Authorization: Bearer bad.token.value" \
     http://localhost:3000/api/v1/customer

# 404 — unknown service
curl -H "Authorization: Bearer $TOKEN" \
     http://localhost:3000/api/v1/nonexistent

# 400 — bad version
curl -H "Authorization: Bearer $TOKEN" \
     http://localhost:3000/api/latest/customer
```

---

## n8n Webhook Setup

For each service, create a webhook node in n8n:

| Service       | Webhook path              | HTTP Method |
|--------------|--------------------------|-------------|
| customer     | `/webhook/customer_service`     | Any         |
| appointment  | `/webhook/appointment_service`  | Any         |
| availability | `/webhook/availability_service` | Any         |
| request      | `/webhook/request_service`      | Any         |

The gateway forwards these headers into n8n that you can use in expressions:

```
{{ $headers['x-user-id'] }}       — authenticated user ID
{{ $headers['x-user-roles'] }}    — user roles (JSON string)
{{ $headers['x-request-id'] }}    — correlation ID
{{ $headers['x-gateway-meta'] }}  — version, service, id, query params (JSON)
```
