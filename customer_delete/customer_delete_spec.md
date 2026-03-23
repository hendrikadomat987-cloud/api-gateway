# Customer DELETE – Workflow Specification

## Overview
Defines the architecture and requirements for customer.delete workflow.

## Endpoint
DELETE /api/v1/customer?id=<id>

## Architecture
Client → API Gateway → n8n → PostgreSQL

## Security
- tenant_id from JWT (Gateway)
- Never trust client input
- Always filter by tenant_id

## Workflow
Webhook → Set → Validate → IF(valid)
→ FALSE → Error
→ TRUE → Validate Tenant → Merge → IF(id)
→ FALSE → Error
→ TRUE → DB DELETE → IF(rows)
→ FALSE → NOT_FOUND
→ TRUE → Success

## SQL
DELETE FROM customers WHERE id = $1 AND tenant_id = $2

## Success Response
{
  "success": true,
  "data": { "deleted": true, "id": "..." }
}

## Error Response
{
  "success": false,
  "error": { "code": "...", "message": "..." }
}
