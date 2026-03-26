'use strict';

/**
 * Generates a long-lived test token for the test-engine.
 *
 * Usage:
 *   JWT_SECRET=<your-gateway-secret> node generate-token.js
 *
 * Updates test-engine/.env automatically with the new TOKEN.
 */

const jwt  = require('jsonwebtoken');
const fs   = require('fs');
const path = require('path');
const orgId = process.env.ORG_ID || '11111111-1111-1111-1111-111111111111';

const SECRET = process.env.JWT_SECRET;
if (!SECRET) {
  console.error('ERROR: Set JWT_SECRET env var before running.');
  console.error('  JWT_SECRET=<your-secret> node generate-token.js');
  process.exit(1);
}

const payload = {
  sub:             'test-user-1',
  organization_id: orgId,
  role:            'admin',
  aud:             'voice-api',
  iss:             'am-gastro',
};

const token = jwt.sign(payload, SECRET, {
  algorithm: 'HS256',
  expiresIn: '365d',   // 1 year
});

const envPath = path.resolve(__dirname, '.env');
let envContent = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';

const targetKey = process.env.TARGET || 'TOKEN_TENANT_A';

const regex = new RegExp(`^${targetKey}=.*`, 'm');

if (regex.test(envContent)) {
  envContent = envContent.replace(regex, `${targetKey}=${token}`);
} else {
  envContent += `\n${targetKey}=${token}`;
}

fs.writeFileSync(envPath, envContent);
console.log('Token generated (expires in 1 year) and written to test-engine/.env');
console.log(`${targetKey} updated`);
