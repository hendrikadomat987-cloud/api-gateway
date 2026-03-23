'use strict';

require('dotenv').config();

// ---------------------------------------------------------------------------
// Central configuration — all env reads live here, nowhere else.
// ---------------------------------------------------------------------------

function required(key) {
  const value = process.env[key];
  if (!value) throw new Error(`Missing required environment variable: ${key}`);
  return value;
}

const config = {
  server: {
    port: parseInt(process.env.PORT || '3000', 10),
    env: process.env.NODE_ENV || 'development',
  },

  jwt: {
    secret: required('JWT_SECRET'),
    algorithm: 'HS256',
    // Accepted issuers — set to null to skip issuer check
    issuer: process.env.JWT_ISSUER || null,
    // Accepted audiences — set to null to skip audience check
    audience: process.env.JWT_AUDIENCE || null,
  },

  n8n: {
    baseUrl: (process.env.N8N_BASE_URL || 'http://localhost:5678').replace(/\/$/, ''),
    webhookSecret: process.env.N8N_WEBHOOK_SECRET || null,
    timeoutMs: parseInt(process.env.FORWARD_TIMEOUT_MS || '5000', 10),
  },

  logging: {
    level: process.env.LOG_LEVEL || 'info',
  },

  // ── Service registry ────────────────────────────────────────────────────
  // Each service maps to either:
  //   - a string  → single n8n webhook for all methods (legacy / simple services)
  //   - an object → method-keyed webhook paths (use when n8n webhooks are split by method)
  //
  // Object keys:
  //   METHOD      → matched when the request has NO :id  (e.g. POST /customer)
  //   METHOD_ID   → matched when the request HAS  an :id (e.g. GET  /customer/123)
  //
  services: {
    customer: {
      POST:      'customer/create',   // POST   /api/v1/customer
      GET:       'customer/get',      // GET    /api/v1/customer
      GET_ID:    'customer/get',      // GET    /api/v1/customer/:id
      PUT_ID:    'customer/update',   // PUT    /api/v1/customer/:id
      DELETE_ID: 'customer/delete',   // DELETE /api/v1/customer/:id
    },
    appointment:  'appointment_service',
    availability: 'availability_service',
    request:      'request_service',
  },
};

module.exports = config;
