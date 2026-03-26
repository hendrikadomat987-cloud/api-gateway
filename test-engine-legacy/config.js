'use strict';

require('dotenv').config({
  path: require('path').resolve(__dirname, '.env')
});

console.log("TEST ENGINE TOKEN:", process.env.TOKEN);

module.exports = {
  // API Gateway base URL — includes version segment
  baseUrl: process.env.API_BASE_URL || 'http://localhost:3000/api/v1',

  // Tokens — use static values for now; swap for dynamic generation later
  tokens: {
    valid:       process.env.TOKEN               || '',
    wrongTenant: process.env.WRONG_TENANT_TOKEN  || 'wrong-tenant-token',
    expired:     process.env.EXPIRED_TOKEN       || 'expired-token',
    invalid:     'this-is-not-a-valid-jwt',
  },

  // HTTP timeout per request (ms)
  timeoutMs: parseInt(process.env.TIMEOUT_MS || '10000', 10),

  // When true, a CRITICAL test failure stops the entire suite immediately
  stopOnCritical: process.env.STOP_ON_CRITICAL !== 'false',
};
