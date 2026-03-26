# MASTER PROMPT V2 (STANDARD)

## PHASES

### 1. GENERATE

-   n8n Workflow JSON
-   PostgreSQL RPC SQL
-   API Gateway changes
-   Tests

### 2. APPLY / DEPLOY

1.  Apply SQL to DB
2.  Import & activate workflow
3.  Deploy gateway

### 3. TEST

Run tests ONLY after all above steps.

## RULES

-   tenant_id only from JWT
-   RPC-first
-   RLS + FORCE RLS
-   UUID validation
-   Input sanitization

## RESPONSE

Success: { "success": true, "data": {} }

Error: { "success": false, "error": { "code": "ERROR_CODE", "message":
"..." } }
