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

const SECRET = process.env.JWT_SECRET;
if (!SECRET) {
  console.error('ERROR: Set JWT_SECRET env var before running.');
  console.error('  JWT_SECRET=<your-secret> node generate-token.js');
  process.exit(1);
}

const payload = {
  sub:             'test-user-1',
  organization_id: '11111111-1111-1111-1111-111111111111',
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

if (/^TOKEN=/m.test(envContent)) {
  envContent = envContent.replace(/^TOKEN=.*/m, `TOKEN=${token}`);
} else {
  envContent += `\nTOKEN=${token}`;
}

fs.writeFileSync(envPath, envContent);
console.log('Token generated (expires in 1 year) and written to test-engine/.env');
console.log('TOKEN=' + token.slice(0, 40) + '...');
