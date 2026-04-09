'use strict';

/**
 * Voice — Feature Tenant Isolation
 *
 * Verifies that the GET /api/v1/features endpoint returns ONLY the features
 * and domains belonging to the calling tenant, and that one tenant cannot
 * read another tenant's feature set.
 *
 *   A. Tenant A — has booking + restaurant domains
 *   B. Tenant B — has voice domain only
 *   C. Salon tenant (Morgenlicht) — has voice + salon domains
 *   D. Salon tenant 2 (Studio Nord) — has voice + salon domains
 *   E. Feature sets of Tenant A and Tenant B are disjoint where expected
 *   F. Feature sets of Salon 1 and Salon 2 match (same domains, not same data)
 *   G. Auth — missing token returns 401
 *   H. Auth — expired token returns 401
 */

const config  = require('../../config/config');
const { getTenantFeatures } = require('../../core/apiClient');
const { createClient }      = require('../../core/apiClient');

jest.setTimeout(30000);

const TOKEN_A      = config.tokens.tenantA;
const TOKEN_B      = config.tokens.tenantB;
const TOKEN_SALON  = config.tokens.tenantSalon;
const TOKEN_SALON2 = config.tokens.tenantSalon2;

// ─────────────────────────────────────────────────────────────────────────────

describe('voice / feature / tenant-isolation', () => {
  // ── A. Tenant A ─────────────────────────────────────────────────────────────

  describe('A. Tenant A — booking + restaurant domains', () => {
    let data;

    beforeAll(async () => {
      const res = await getTenantFeatures(TOKEN_A);
      expect(res.status).toBe(200);
      data = res.data.data;
    });

    it('response shape is correct', () => {
      expect(Array.isArray(data.features)).toBe(true);
      expect(Array.isArray(data.domains)).toBe(true);
    });

    it('has voice domain', () => {
      expect(data.domains).toContain('voice');
    });

    it('has booking domain', () => {
      expect(data.domains).toContain('booking');
    });

    it('has restaurant domain', () => {
      expect(data.domains).toContain('restaurant');
    });

    it('does NOT have salon domain', () => {
      expect(data.domains).not.toContain('salon');
    });

    it('has voice.core feature', () => {
      expect(data.features).toContain('voice.core');
    });

    it('has booking.core feature', () => {
      expect(data.features).toContain('booking.core');
    });

    it('has restaurant.core feature', () => {
      expect(data.features).toContain('restaurant.core');
    });

    it('does NOT have salon.core feature', () => {
      expect(data.features).not.toContain('salon.core');
    });
  });

  // ── B. Tenant B ─────────────────────────────────────────────────────────────

  describe('B. Tenant B — voice-only domain', () => {
    let data;

    beforeAll(async () => {
      const res = await getTenantFeatures(TOKEN_B);
      expect(res.status).toBe(200);
      data = res.data.data;
    });

    it('has voice domain', () => {
      expect(data.domains).toContain('voice');
    });

    it('does NOT have booking domain', () => {
      expect(data.domains).not.toContain('booking');
    });

    it('does NOT have restaurant domain', () => {
      expect(data.domains).not.toContain('restaurant');
    });

    it('does NOT have salon domain', () => {
      expect(data.domains).not.toContain('salon');
    });

    it('has voice.core feature', () => {
      expect(data.features).toContain('voice.core');
    });

    it('does NOT have booking.core feature', () => {
      expect(data.features).not.toContain('booking.core');
    });
  });

  // ── C. Salon tenant 1 (Morgenlicht) ─────────────────────────────────────────

  describe('C. Salon tenant (Morgenlicht) — voice + salon domains', () => {
    let data;

    beforeAll(async () => {
      if (!TOKEN_SALON) {
        console.warn('  ⚠ TOKEN_TENANT_SALON not set — skipping section C');
        return;
      }
      const res = await getTenantFeatures(TOKEN_SALON);
      expect(res.status).toBe(200);
      data = res.data.data;
    });

    it('has voice domain', () => {
      if (!TOKEN_SALON) return;
      expect(data.domains).toContain('voice');
    });

    it('has salon domain', () => {
      if (!TOKEN_SALON) return;
      expect(data.domains).toContain('salon');
    });

    it('does NOT have booking domain', () => {
      if (!TOKEN_SALON) return;
      expect(data.domains).not.toContain('booking');
    });

    it('does NOT have restaurant domain', () => {
      if (!TOKEN_SALON) return;
      expect(data.domains).not.toContain('restaurant');
    });

    it('has salon.core feature', () => {
      if (!TOKEN_SALON) return;
      expect(data.features).toContain('salon.core');
    });

    it('does NOT have restaurant.core feature', () => {
      if (!TOKEN_SALON) return;
      expect(data.features).not.toContain('restaurant.core');
    });
  });

  // ── D. Salon tenant 2 (Studio Nord) ─────────────────────────────────────────

  describe('D. Salon tenant 2 (Studio Nord) — voice + salon domains', () => {
    let data;

    beforeAll(async () => {
      if (!TOKEN_SALON2) {
        console.warn('  ⚠ TOKEN_TENANT_SALON_2 not set — skipping section D');
        return;
      }
      const res = await getTenantFeatures(TOKEN_SALON2);
      expect(res.status).toBe(200);
      data = res.data.data;
    });

    it('has salon domain', () => {
      if (!TOKEN_SALON2) return;
      expect(data.domains).toContain('salon');
    });

    it('has salon.core feature', () => {
      if (!TOKEN_SALON2) return;
      expect(data.features).toContain('salon.core');
    });

    it('does NOT have booking domain', () => {
      if (!TOKEN_SALON2) return;
      expect(data.domains).not.toContain('booking');
    });
  });

  // ── E. Tenant A vs Tenant B are disjoint ────────────────────────────────────

  describe('E. Tenant A vs Tenant B — feature sets are disjoint (no booking leak)', () => {
    let dataA;
    let dataB;

    beforeAll(async () => {
      const [resA, resB] = await Promise.all([
        getTenantFeatures(TOKEN_A),
        getTenantFeatures(TOKEN_B),
      ]);
      expect(resA.status).toBe(200);
      expect(resB.status).toBe(200);
      dataA = resA.data.data;
      dataB = resB.data.data;
    });

    it('Tenant B cannot see booking.core even though Tenant A has it', () => {
      expect(dataA.features).toContain('booking.core');
      expect(dataB.features).not.toContain('booking.core');
    });

    it('Tenant B cannot see restaurant.core even though Tenant A has it', () => {
      expect(dataA.features).toContain('restaurant.core');
      expect(dataB.features).not.toContain('restaurant.core');
    });

    it('Tenant A cannot see salon.core (not provisioned for Tenant A)', () => {
      expect(dataA.features).not.toContain('salon.core');
    });
  });

  // ── F. Salon 1 vs Salon 2 — same domains, isolated data ─────────────────────

  describe('F. Salon 1 vs Salon 2 — same feature set, isolated tenants', () => {
    let dataSalon1;
    let dataSalon2;

    beforeAll(async () => {
      if (!TOKEN_SALON || !TOKEN_SALON2) {
        console.warn('  ⚠ TOKEN_TENANT_SALON or TOKEN_TENANT_SALON_2 not set — skipping section F');
        return;
      }
      const [res1, res2] = await Promise.all([
        getTenantFeatures(TOKEN_SALON),
        getTenantFeatures(TOKEN_SALON2),
      ]);
      expect(res1.status).toBe(200);
      expect(res2.status).toBe(200);
      dataSalon1 = res1.data.data;
      dataSalon2 = res2.data.data;
    });

    it('both salon tenants have salon.core', () => {
      if (!TOKEN_SALON || !TOKEN_SALON2) return;
      expect(dataSalon1.features).toContain('salon.core');
      expect(dataSalon2.features).toContain('salon.core');
    });

    it('both salon tenants have voice domain', () => {
      if (!TOKEN_SALON || !TOKEN_SALON2) return;
      expect(dataSalon1.domains).toContain('voice');
      expect(dataSalon2.domains).toContain('voice');
    });
  });

  // ── G. Missing token returns 401 ────────────────────────────────────────────

  describe('G. Auth — missing token returns 401', () => {
    it('returns 401 with no Authorization header', async () => {
      const res = await createClient({ token: '' }).get('/api/v1/features');
      expect(res.status).toBe(401);
    });
  });

  // ── H. Expired token returns 401 ────────────────────────────────────────────

  describe('H. Auth — expired token returns 401', () => {
    it('returns 401 with expired JWT', async () => {
      const res = await getTenantFeatures(config.tokens.expired);
      expect(res.status).toBe(401);
    });
  });
});
