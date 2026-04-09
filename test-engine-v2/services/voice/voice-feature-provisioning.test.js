'use strict';

/**
 * Voice — Feature Provisioning
 *
 * Smoke tests that verify the migration ran and all four tenant seed entries
 * are in place by inspecting the GET /api/v1/features endpoint.
 *
 * These are NOT unit tests of the provisioning SQL — they validate the end
 * state visible to each tenant's JWT.
 *
 *   A. All expected feature keys exist for Tenant A
 *   B. All expected feature keys exist for Tenant B
 *   C. All expected feature keys exist for Salon tenant (Morgenlicht)
 *   D. All expected feature keys exist for Salon tenant 2 (Studio Nord)
 *   E. Feature key catalogue — every provisioned tenant returns known keys only
 */

const config = require('../../config/config');
const { getTenantFeatures } = require('../../core/apiClient');

jest.setTimeout(30000);

// ── Expected feature sets per tenant ─────────────────────────────────────────
// These mirror the domain_features seed in 20260409000000_feature_system_v1.sql.
//
// Domain → feature mapping (authoritative):
//   voice:      voice.core, voice.callback
//   booking:    booking.core, booking.availability, booking.faq
//   restaurant: restaurant.core, restaurant.menu, restaurant.ordering, restaurant.delivery
//   salon:      salon.core, salon.booking, salon.availability

const EXPECTED = {
  tenantA: {
    // Tenant A: voice + booking + restaurant
    domains:  ['voice', 'booking', 'restaurant'],
    features: [
      'voice.core', 'voice.callback',
      'booking.core', 'booking.availability', 'booking.faq',
      'restaurant.core', 'restaurant.menu', 'restaurant.ordering', 'restaurant.delivery',
    ],
  },
  tenantB: {
    // Tenant B: voice only
    domains:  ['voice'],
    features: ['voice.core', 'voice.callback'],
  },
  salon: {
    // Morgenlicht: voice + salon
    domains:  ['voice', 'salon'],
    features: ['voice.core', 'voice.callback', 'salon.core', 'salon.booking', 'salon.availability'],
  },
  salon2: {
    // Studio Nord: voice + salon (same domain set as Morgenlicht)
    domains:  ['voice', 'salon'],
    features: ['voice.core', 'voice.callback', 'salon.core', 'salon.booking', 'salon.availability'],
  },
};

// ── Known valid feature keys (full catalogue, 12 keys) ───────────────────────
// Mirrors the INSERT INTO features block in 20260409000000_feature_system_v1.sql.

const ALL_KNOWN_FEATURE_KEYS = new Set([
  'voice.core',
  'voice.callback',
  'booking.core',
  'booking.availability',
  'booking.faq',
  'restaurant.core',
  'restaurant.menu',
  'restaurant.ordering',
  'restaurant.delivery',
  'salon.core',
  'salon.booking',
  'salon.availability',
]);

async function fetchFeatures(token) {
  const res = await getTenantFeatures(token);
  expect(res.status).toBe(200);
  return res.data.data;
}

// ─────────────────────────────────────────────────────────────────────────────

describe('voice / feature / provisioning', () => {
  // ── A. Tenant A ─────────────────────────────────────────────────────────────

  describe('A. Tenant A — all booking + restaurant features provisioned', () => {
    let data;

    beforeAll(async () => {
      data = await fetchFeatures(config.tokens.tenantA);
    });

    for (const domain of EXPECTED.tenantA.domains) {
      it(`domain '${domain}' is present`, () => {
        expect(data.domains).toContain(domain);
      });
    }

    for (const feature of EXPECTED.tenantA.features) {
      it(`feature '${feature}' is present`, () => {
        expect(data.features).toContain(feature);
      });
    }
  });

  // ── B. Tenant B ─────────────────────────────────────────────────────────────

  describe('B. Tenant B — voice-only features provisioned', () => {
    let data;

    beforeAll(async () => {
      data = await fetchFeatures(config.tokens.tenantB);
    });

    for (const domain of EXPECTED.tenantB.domains) {
      it(`domain '${domain}' is present`, () => {
        expect(data.domains).toContain(domain);
      });
    }

    for (const feature of EXPECTED.tenantB.features) {
      it(`feature '${feature}' is present`, () => {
        expect(data.features).toContain(feature);
      });
    }
  });

  // ── C. Salon tenant (Morgenlicht) ────────────────────────────────────────────

  describe('C. Salon tenant (Morgenlicht) — voice + salon features provisioned', () => {
    let data;

    beforeAll(async () => {
      if (!config.tokens.tenantSalon) {
        console.warn('  ⚠ TOKEN_TENANT_SALON not set — skipping section C');
        return;
      }
      data = await fetchFeatures(config.tokens.tenantSalon);
    });

    for (const domain of EXPECTED.salon.domains) {
      it(`domain '${domain}' is present`, () => {
        if (!config.tokens.tenantSalon) return;
        expect(data.domains).toContain(domain);
      });
    }

    for (const feature of EXPECTED.salon.features) {
      it(`feature '${feature}' is present`, () => {
        if (!config.tokens.tenantSalon) return;
        expect(data.features).toContain(feature);
      });
    }
  });

  // ── D. Salon tenant 2 (Studio Nord) ──────────────────────────────────────────

  describe('D. Salon tenant 2 (Studio Nord) — voice + salon features provisioned', () => {
    let data;

    beforeAll(async () => {
      if (!config.tokens.tenantSalon2) {
        console.warn('  ⚠ TOKEN_TENANT_SALON_2 not set — skipping section D');
        return;
      }
      data = await fetchFeatures(config.tokens.tenantSalon2);
    });

    for (const domain of EXPECTED.salon2.domains) {
      it(`domain '${domain}' is present`, () => {
        if (!config.tokens.tenantSalon2) return;
        expect(data.domains).toContain(domain);
      });
    }

    for (const feature of EXPECTED.salon2.features) {
      it(`feature '${feature}' is present`, () => {
        if (!config.tokens.tenantSalon2) return;
        expect(data.features).toContain(feature);
      });
    }
  });

  // ── E. No unknown feature keys returned ──────────────────────────────────────

  describe('E. No unknown feature keys in any tenant response', () => {
    const tokenEntries = [
      ['tenantA', config.tokens.tenantA],
      ['tenantB', config.tokens.tenantB],
      ...(config.tokens.tenantSalon  ? [['tenantSalon',  config.tokens.tenantSalon]]  : []),
      ...(config.tokens.tenantSalon2 ? [['tenantSalon2', config.tokens.tenantSalon2]] : []),
    ];

    for (const [label, token] of tokenEntries) {
      it(`${label} — all returned features are in the known catalogue`, async () => {
        const d = await fetchFeatures(token);
        for (const key of d.features) {
          expect(ALL_KNOWN_FEATURE_KEYS.has(key)).toBe(true);
        }
      });
    }
  });
});
