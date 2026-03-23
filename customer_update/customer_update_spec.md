# Customer UPDATE – Workflow Specification (Final)

## Overview
Defines the architecture and requirements for customer.update workflow.

This workflow must be fully consistent with:
- customer_create
- customer_get
- customer_delete

## Endpoint
PUT /api/v1/customer?id=<id>

## Architecture
Client → API Gateway → n8n → PostgreSQL

## Security Rules
- tenant_id comes exclusively from JWT (set by API Gateway)
- NEVER trust client input
- tenant_id must NOT be overridden
- ALL database queries MUST include tenant_id

## Input
- tenant_id → $json.body.tenant_id
- id → $json.query.id
- optional fields:
  - name
  - phone
  - email

## Validation Rules

Required:
- tenant_id must exist
- id must exist

Business Rule:
At least ONE of the following fields must be provided:
- name
- phone
- email

Validation Logic:
- tenant_id missing → VALIDATION_ERROR
- id missing → MISSING_ID
- no update fields → VALIDATION_ERROR

## Workflow Structure

Webhook (PUT)
→ Set Fields (normalize input)
→ Validate

→ IF (valid?)

    → FALSE:
        → Respond Error (VALIDATION_ERROR / MISSING_ID)

    → TRUE:
        → Validate Tenant
        → Merge

        → IF (id exists?)

            → FALSE:
                → Respond Error (MISSING_ID)

            → TRUE:
                → DB UPDATE

                → IF (rows affected?)

                    → FALSE:
                        → Respond Error (NOT_FOUND)

                    → TRUE:
                        → Format Response
                        → Respond Success

## Database Query

UPDATE customers
SET
  name = COALESCE($1, name),
  phone = COALESCE($2, phone),
  email = COALESCE($3, email)
WHERE id = $4
AND tenant_id = $5

Params:
={{ [ $json.name, $json.phone, $json.email, $json.id, $json.tenant_id ] }}

## Success Response

{
  "success": true,
  "data": {
    "id": "...",
    "updated": true
  }
}

## Error Response

{
  "success": false,
  "error": {
    "code": "...",
    "message": "..."
  }
}

## Error Codes

- VALIDATION_ERROR
- MISSING_ID
- NOT_FOUND
