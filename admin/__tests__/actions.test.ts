/**
 * Unit tests for Server Actions.
 *
 * Verifies that each action:
 *   1. Constructs the correct backend API URL
 *   2. Sends the correct HTTP method and body
 *   3. Attaches the ADMIN_TOKEN Authorization header
 *   4. Returns { success: true } on a 200 backend response
 *   5. Returns { success: false, error: string } on a backend failure
 *
 * next/cache (revalidatePath) and next/navigation are mocked via __mocks__/.
 */

import { revalidatePath } from 'next/cache';

import {
  assignPlanAction,
  enableFeatureAction,
  disableFeatureAction,
  enableDomainAction,
  disableDomainAction,
  setLimitAction,
  deleteLimitAction,
} from '../actions/tenant';
import { resetUsageAction } from '../actions/usage';

// ── Setup ─────────────────────────────────────────────────────────────────────

const BACKEND_URL  = 'http://localhost:4000';
const ADMIN_TOKEN  = 'test-secret-token';
const TENANT_ID    = 'aaaaaaaa-0000-0000-0000-000000000001';

const mockFetch = jest.fn();
global.fetch = mockFetch;

beforeEach(() => {
  mockFetch.mockClear();
  (revalidatePath as jest.Mock).mockClear();
  process.env.BACKEND_URL  = BACKEND_URL;
  process.env.ADMIN_TOKEN  = ADMIN_TOKEN;
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function mockOk(data: unknown = {}) {
  mockFetch.mockResolvedValueOnce({
    ok:   true,
    json: async () => ({ success: true, data }),
  });
}

function mockError(status: number, message: string) {
  mockFetch.mockResolvedValueOnce({
    ok:   false,
    json: async () => ({ success: false, error: { code: 'ERR', message } }),
  });
}

function expectPost(path: string, body: unknown) {
  expect(mockFetch).toHaveBeenCalledWith(
    `${BACKEND_URL}/api/v1/internal/admin${path}`,
    expect.objectContaining({
      method:  'POST',
      headers: expect.objectContaining({ Authorization: `Bearer ${ADMIN_TOKEN}` }),
      body:    JSON.stringify(body),
    }),
  );
}

function expectDelete(path: string, body: unknown) {
  expect(mockFetch).toHaveBeenCalledWith(
    `${BACKEND_URL}/api/v1/internal/admin${path}`,
    expect.objectContaining({
      method:  'DELETE',
      headers: expect.objectContaining({ Authorization: `Bearer ${ADMIN_TOKEN}` }),
      body:    JSON.stringify(body),
    }),
  );
}

// ── assignPlanAction ──────────────────────────────────────────────────────────

describe('assignPlanAction', () => {
  it('posts plan to backend and returns success', async () => {
    mockOk({ tenant_id: TENANT_ID, plan: 'pro' });
    const result = await assignPlanAction(TENANT_ID, 'pro');
    expect(result.success).toBe(true);
    expectPost(`/tenants/${TENANT_ID}/plan`, { plan: 'pro' });
  });

  it('calls revalidatePath for the tenant detail page', async () => {
    mockOk();
    await assignPlanAction(TENANT_ID, 'starter');
    expect(revalidatePath).toHaveBeenCalledWith(`/tenants/${TENANT_ID}`);
  });

  it('returns error on backend failure', async () => {
    mockError(404, 'Plan not found');
    const result = await assignPlanAction(TENANT_ID, 'unknown-plan');
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toBe('Plan not found');
  });
});

// ── enableFeatureAction ───────────────────────────────────────────────────────

describe('enableFeatureAction', () => {
  it('posts feature enable and returns success', async () => {
    mockOk();
    const result = await enableFeatureAction(TENANT_ID, 'voice.core');
    expect(result.success).toBe(true);
    expectPost(`/tenants/${TENANT_ID}/features/enable`, { feature: 'voice.core' });
  });

  it('returns error when backend rejects unknown feature', async () => {
    mockError(404, 'Unknown feature: nonexistent');
    const result = await enableFeatureAction(TENANT_ID, 'nonexistent');
    expect(result.success).toBe(false);
  });
});

// ── disableFeatureAction ──────────────────────────────────────────────────────

describe('disableFeatureAction', () => {
  it('posts feature disable', async () => {
    mockOk();
    await disableFeatureAction(TENANT_ID, 'voice.core');
    expectPost(`/tenants/${TENANT_ID}/features/disable`, { feature: 'voice.core' });
  });
});

// ── enableDomainAction ────────────────────────────────────────────────────────

describe('enableDomainAction', () => {
  it('posts domain enable', async () => {
    mockOk();
    await enableDomainAction(TENANT_ID, 'restaurant');
    expectPost(`/tenants/${TENANT_ID}/domains/enable`, { domain: 'restaurant' });
  });
});

// ── disableDomainAction ───────────────────────────────────────────────────────

describe('disableDomainAction', () => {
  it('posts domain disable', async () => {
    mockOk();
    await disableDomainAction(TENANT_ID, 'restaurant');
    expectPost(`/tenants/${TENANT_ID}/domains/disable`, { domain: 'restaurant' });
  });
});

// ── setLimitAction ────────────────────────────────────────────────────────────

describe('setLimitAction', () => {
  it('posts numeric override', async () => {
    mockOk();
    const result = await setLimitAction(TENANT_ID, 'voice.core', 'tool_calls_per_month', 500);
    expect(result.success).toBe(true);
    expectPost(`/tenants/${TENANT_ID}/limits`, {
      feature_key: 'voice.core',
      limit_type:  'tool_calls_per_month',
      limit_value: 500,
    });
  });

  it('posts null (explicit unlimited) override', async () => {
    mockOk();
    await setLimitAction(TENANT_ID, 'voice.core', 'tool_calls_per_month', null);
    expectPost(`/tenants/${TENANT_ID}/limits`, {
      feature_key: 'voice.core',
      limit_type:  'tool_calls_per_month',
      limit_value: null,
    });
  });

  it('returns error on failure', async () => {
    mockError(400, 'Invalid limit_value');
    const result = await setLimitAction(TENANT_ID, 'voice.core', 'tool_calls_per_month', -1);
    expect(result.success).toBe(false);
  });
});

// ── deleteLimitAction ─────────────────────────────────────────────────────────

describe('deleteLimitAction', () => {
  it('sends DELETE with correct body', async () => {
    mockOk();
    const result = await deleteLimitAction(TENANT_ID, 'voice.core', 'tool_calls_per_month');
    expect(result.success).toBe(true);
    expectDelete(`/tenants/${TENANT_ID}/limits`, {
      feature_key: 'voice.core',
      limit_type:  'tool_calls_per_month',
    });
  });
});

// ── resetUsageAction ──────────────────────────────────────────────────────────

describe('resetUsageAction', () => {
  it('posts empty body for current-period reset', async () => {
    mockOk({ deleted: 3, period_start: '2026-04-01' });
    const result = await resetUsageAction(TENANT_ID);
    expect(result.success).toBe(true);
    expectPost(`/tenants/${TENANT_ID}/usage/reset`, {});
  });

  it('posts period_start when provided', async () => {
    mockOk({ deleted: 1 });
    await resetUsageAction(TENANT_ID, '2026-03-01');
    expectPost(`/tenants/${TENANT_ID}/usage/reset`, { period_start: '2026-03-01' });
  });

  it('calls revalidatePath', async () => {
    mockOk();
    await resetUsageAction(TENANT_ID);
    expect(revalidatePath).toHaveBeenCalledWith(`/tenants/${TENANT_ID}`);
  });

  it('returns error on backend failure', async () => {
    mockError(500, 'Database error');
    const result = await resetUsageAction(TENANT_ID);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toContain('Database error');
  });
});
