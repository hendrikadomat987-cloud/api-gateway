# Customer GET Security Upgrade

## Goal
Refactor the existing Customer GET workflow to match the secure architecture of Customer Create.

## Security Rules
- NEVER read tenant_id from headers
- ALWAYS use tenant_id from request body (injected by API Gateway)
- NEVER trust client input
- ALL queries must filter by tenant_id

## Required Changes

### 1. Set Fields Node
Replace:
$json.headers['x-tenant-id']

With:
{{$json.body.tenant_id}}

---

### 2. Validation
Ensure:
- tenant_id required
- consistent structure with Create

---

### 3. Database Queries
Always include:
WHERE tenant_id = $1

---

### 4. Response Format
SUCCESS:
{
  "success": true,
  "data": [...]
}

ERROR:
{
  "success": false,
  "error": "VALIDATION_ERROR"
}

---

## Final Flow
Webhook → Set Fields → Validate → Validate Tenant → Query → Respond
