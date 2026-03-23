# Customer Service -- n8n Workflow Specification

## Overview

This document defines the Customer Service workflow for the Voice-Agent
SaaS platform.

## Endpoint

POST /api/v1/customer → /webhook/customer

## Input

### Body

{ "name": "Max Mustermann", "phone": "123456789", "email": "max@test.de"
}

## Workflow

1.  Webhook Node
2.  Set Node
3.  Validation
4.  DB Insert
5.  Respond

## Response

Success: { "success": true }

Error: { "success": false }
