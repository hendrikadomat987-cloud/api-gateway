# Test Engine Specification

## Goal
Reusable Node.js test system for API Gateway + n8n workflows.

## Architecture

### Core
- apiClient.js (axios instance)
- testRunner.js (CRUD logic)

### Pattern
1. Arrange (prepare data)
2. Act (API calls)
3. Assert (validate responses)
4. Cleanup (delete test data)

## Features
- JWT auth via env
- Multi-tenant safe
- Reusable across services

## Usage
node tests/customer/crud.test.js

## Expected Output
- Success logs
- Errors on failure
