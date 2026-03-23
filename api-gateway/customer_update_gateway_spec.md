# Customer Update – API Gateway Specification

## Path
PUT /api/v1/customer/:id

## Location
C:\Users\hendr\claude-ai-voice-agent\api-gateway\

## Auth
JWT required
tenant_id extracted from token

## Validation
- At least one of: name, phone, email
- Email must contain '@' and '.'

## Security
- Remove unknown fields
- Do NOT accept tenant_id from client

## Forwarding
/webhook/customer/update?id=:id

## Errors
- VALIDATION_ERROR (400)
- MISSING_ID (400)
- INVALID_ID (400)

## Success
Pass-through from n8n
