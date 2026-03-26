'use strict';

/**
 * Resources — Row-Level Security (RLS) Test Suite
 */

const { createClient }   = require('../../core/apiClient');
const { TestContext }     = require('../../core/context');
const { cleanupContext }  = require('../../core/cleanup');
const { resourceFactory } = require('../../core/factories');
const {
  expectSuccess,
  expectNoDataLeak,
} = require('../../core/assertions');
const config = require('../../config/config');

const tenantA = createClient({ token: config.tokens.tenantA });
const tenantB = createClient({ token: config.tokens.tenantB });

const ctx = new TestContext();
let ownedId;

beforeAll(async () => {
  const res = await tenantA.post('/resources', resourceFactory());
  ownedId   = expectSuccess(res).id;
  ctx.register('resources', ownedId);
});

afterAll(async () => {
  await cleanupContext(ctx);
});

// ═════════════════════════════════════════════════════════════════════════════
// CROSS-TENANT READ
// ═════════════════════════════════════════════════════════════════════════════

describe('Resources RLS — Cross-tenant GET', () => {
  it('Tenant B cannot read Tenant A resource by ID', async () => {
    expectNoDataLeak(await tenantB.get(`/resources/${ownedId}`), ownedId);
  });

  it('Tenant B list does not contain Tenant A resource', async () => {
    const res = await tenantB.get('/resources');
    if (res.status === 200 && Array.isArray(res.data?.data)) {
      const leaked = res.data.data.find((r) => r.id === ownedId);
      expect(leaked).toBeUndefined();
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// CROSS-TENANT UPDATE
// ═════════════════════════════════════════════════════════════════════════════

describe('Resources RLS — Cross-tenant PUT', () => {
  it('Tenant B cannot update Tenant A resource', async () => {
    expectNoDataLeak(
      await tenantB.put(`/resources/${ownedId}`, { name: 'HIJACKED' }),
      ownedId
    );
  });

  it('Tenant A resource name is unchanged', async () => {
    const res  = await tenantA.get(`/resources/${ownedId}`);
    const data = expectSuccess(res);
    expect(data.name).not.toBe('HIJACKED');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// CROSS-TENANT DELETE
// ═════════════════════════════════════════════════════════════════════════════

describe('Resources RLS — Cross-tenant DELETE', () => {
  it('Tenant B cannot delete Tenant A resource', async () => {
    const res = await tenantB.delete(`/resources/${ownedId}`);

    if (res.status === 200 && res.data?.success === true) {
      const verify = await tenantA.get(`/resources/${ownedId}`);
      expect(verify.status).toBe(200);
      expect(verify.data?.data?.id).toBe(ownedId);
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// INTEGRITY CHECK
// ═════════════════════════════════════════════════════════════════════════════

describe('Resources RLS — Post-attack integrity', () => {
  it('Tenant A resource is intact after all cross-tenant attempts', async () => {
    const data = expectSuccess(await tenantA.get(`/resources/${ownedId}`));
    expect(data.id).toBe(ownedId);
  });
});
