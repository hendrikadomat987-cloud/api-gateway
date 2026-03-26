# API Gateway Test Engine

Production-grade automated test suite for the multi-service API Gateway.

Tech stack: **Node.js · Axios · Jest**

---

## Setup

### 1. Install dependencies

```bash
cd test-engine
npm install
```

### 2. Configure environment

Copy the template and fill in your values:

```bash
cp .env.example .env   # or edit .env directly
```

Required `.env` variables:

```env
# API base URL
API_BASE_URL=http://<host>:3000/api/v1

# Tenant A — primary test token (JWT with organization_id for tenant A)
TOKEN_TENANT_A=eyJ...

# Tenant B — cross-tenant test token (JWT with a DIFFERENT organization_id)
TOKEN_TENANT_B=eyJ...
```

Optional:

```env
# An expired JWT — used to verify 401 TOKEN_EXPIRED responses
TOKEN_EXPIRED=eyJ...

# An invalid/malformed string — used to verify 401 INVALID_TOKEN responses
TOKEN_INVALID=not-a-valid-jwt

# HTTP timeout per request (ms, default 10000)
TIMEOUT_MS=10000

# Retry count on network errors (default 3)
RETRY_COUNT=3

# Base retry delay in ms — doubles on each attempt (default 500)
RETRY_DELAY_MS=500

# Log level: debug | info | warn | error (default warn)
LOG_LEVEL=warn
```

> If `API_BASE_URL`, `TOKEN_TENANT_A`, or `TOKEN_TENANT_B` are missing, the test engine will print a clear error and exit immediately.

### 3. Generate a fresh token (if expired)

```bash
node generate-token.js
```

Reads `JWT_SECRET` from `.env`, writes a new 1-year token to `TOKEN_TENANT_A` in `.env`.

---

## Running tests

### All tests (default — Jest engine)

```bash
npm test
# or
node run-tests.js
```

### By service

```bash
npm run test:customers
npm run test:requests
npm run test:resources
npm run test:scenarios
```

### CI mode (serial + force-exit)

```bash
npm run test:ci
# or
node run-tests.js --ci
```

### Filter by pattern

```bash
node run-tests.js --filter rls
node run-tests.js --filter customers
```

### Legacy runner (tests/ directory)

```bash
node run-tests.js --legacy
```

---

## Multi-tenant testing

The test suite uses two separate tenants to verify Row-Level Security:

| Token | Config key | Purpose |
|-------|-----------|---------|
| `TOKEN_TENANT_A` | `config.tokens.tenantA` | Primary tenant — creates and owns resources |
| `TOKEN_TENANT_B` | `config.tokens.tenantB` | Attacker tenant — attempts cross-tenant access |
| `TOKEN_EXPIRED` | `config.tokens.expired` | Expired JWT — verifies 401 handling |
| `TOKEN_INVALID` | `config.tokens.invalid` | Invalid string — verifies 401 handling |

In test files:

```js
const clientA       = createClient({ token: config.tokens.tenantA });
const clientB       = createClient({ token: config.tokens.tenantB });
const clientNoAuth  = createClient({ token: '' });
const clientExpired = createClient({ token: config.tokens.expired });
```

---

## Project structure

```
test-engine/
├── config/
│   └── config.js           # Centralised config + validation (fails fast on missing vars)
├── core/
│   ├── apiClient.js         # Axios wrapper with retry logic
│   ├── assertions.js        # Jest helpers: expectSuccess, expectNoDataLeak, etc.
│   ├── cleanup.js           # FK-safe resource deletion (never throws)
│   ├── context.js           # Per-test state container (register, get, set, reset)
│   ├── factories.js         # Unique test data generators (no tenant_id, no hardcoded IDs)
│   └── logger.js            # Levelled console logger
├── services/
│   ├── customers/           # Customer CRUD, gateway security, RLS tests
│   ├── requests/            # Request CRUD, gateway security, RLS tests
│   └── resources/           # Resource CRUD, gateway security, RLS tests
├── scenarios/
│   ├── full-flow.test.js    # 16-step end-to-end lifecycle across all services
│   └── tenant-isolation.test.js  # Cross-service tenant isolation scenario
├── tests/                   # Legacy custom-runner tests (--legacy mode)
├── jest.config.js
├── run-tests.js             # Unified entry point
├── generate-token.js        # JWT generator utility
└── .env                     # Local environment variables (not committed)
```

---

## How cleanup works

Every test file uses a `TestContext` to register created resource IDs:

```js
const ctx = new TestContext();

beforeAll(async () => {
  const res = await client.post('/customer', customerFactory());
  ctx.register('customers', res.data.data.id);
});

afterAll(async () => {
  await cleanupContext(ctx);   // deletes in FK-safe order: requests → resources → customers
});
```

`cleanupContext` never throws — 404s and network errors are logged as warnings only.

To clean up as a specific tenant:

```js
await cleanupContext(ctx, { client: clientA });
```

---

## Adding a new service

1. Create `services/<service-name>/` with three test files:
   - `<service>.crud.test.js` — CRUD lifecycle
   - `<service>.gateway.test.js` — JWT enforcement, UUID validation, input sanitisation
   - `<service>.rls.test.js` — Cross-tenant isolation (tenantA creates, tenantB attacks)

2. Add a route to `core/cleanup.js` `ROUTES` map if the service has its own DELETE endpoint.

3. Add a factory to `core/factories.js`.

4. Add an npm script to `package.json` if desired:
   ```json
   "test:<service>": "jest services/<service-name>"
   ```

---

## Checklist

- [x] Multi-tenant config (`TOKEN_TENANT_A` / `TOKEN_TENANT_B`)
- [x] Tenant-specific clients via `createClient({ token: config.tokens.tenantA })`
- [x] Config validates required vars at startup — fails fast with clear message
- [x] Cleanup is FK-safe, never throws, supports custom client
- [x] Jest default / `--legacy` optional via `run-tests.js`
- [x] `TestContext.reset()` available for multi-phase tests
- [x] Connectivity pre-flight check (warns, does not crash)
- [x] CI mode: `--ci` or `npm run test:ci`
