'use strict';

/**
 * Voice — Restaurant Delivery DB
 *
 * Verifies Order Total Calculation and Delivery Rules (Phase 3):
 *
 *   A. Pickup order: totals calculated, delivery_fee_cents = 0
 *   B. Delivery valid zone: delivery_fee_cents applied, total = subtotal + fee
 *   C. Delivery min order not met: confirm returns error 'min_order_not_met'
 *   D. Delivery invalid zone: confirm returns error 'delivery_zone_not_found'
 *   E. Recalculation after update: subtotal recalculated when quantity changes
 *
 * Seed data (tenant 11111111-1111-1111-1111-111111111111):
 *   Margherita:  8.50 EUR = 850 cents
 *   Cola:        2.80 EUR = 280 cents (below 1500 min)
 *
 * Delivery zones:
 *   50667 → Zone A, fee 250 cents, min order 1500 cents
 *   99999 → not found
 */

const config = require('../../config/config');

const {
  sendVoiceWebhook,
  listVoiceCalls,
} = require('../../core/apiClient');

const {
  buildVapiStatusUpdate,
  buildVapiToolCall,
  uniqueVoiceCallId,
  VAPI_RESTAURANT_ASSISTANT_ID,
} = require('../../core/factories');

const { expectUuid } = require('../../core/assertions');

// ─────────────────────────────────────────────────────────────────────────────

jest.setTimeout(120000);

const TOKEN = config.tokens.tenantA;

// ── helpers ───────────────────────────────────────────────────────────────────

async function setupCall(callId) {
  const res = await sendVoiceWebhook(
    buildVapiStatusUpdate(callId, {}, VAPI_RESTAURANT_ASSISTANT_ID),
  );
  if (res.status >= 300) {
    throw new Error(`Setup failed for ${callId}: ${res.status} ${JSON.stringify(res.data)}`);
  }
  const list = await listVoiceCalls(TOKEN);
  const call = list.data?.data?.find((c) => c.provider_call_id === callId);
  if (!call) throw new Error(`Call not found in list after setup: ${callId}`);
  return call.id;
}

async function toolCall(callId, tool, args) {
  const res = await sendVoiceWebhook(
    buildVapiToolCall(callId, tool, args, VAPI_RESTAURANT_ASSISTANT_ID),
  );
  if (res.status !== 200) {
    throw new Error(`${tool} returned HTTP ${res.status}: ${JSON.stringify(res.data)}`);
  }
  const results = res.data?.results;
  if (!Array.isArray(results) || results.length === 0) {
    throw new Error(`${tool} returned empty results`);
  }
  return results[0].result;
}

// ─────────────────────────────────────────────────────────────────────────────

describe('voice / restaurant / delivery-db', () => {
  let margheritaId; // real UUID from search

  // Resolve real Margherita UUID once for all tests
  beforeAll(async () => {
    const callId = uniqueVoiceCallId('test-delivery-setup');
    await setupCall(callId);
    const res = await toolCall(callId, 'search_menu_item', { query: 'margherita' });
    if (!res.success || !Array.isArray(res.items) || res.items.length === 0) {
      throw new Error(`search_menu_item('margherita') failed: ${JSON.stringify(res)}`);
    }
    margheritaId = res.items[0].id;
    if (!/^[0-9a-f-]{36}$/i.test(margheritaId)) {
      throw new Error(`margheritaId is not a UUID: ${margheritaId}`);
    }
  });

  // ── A: Pickup total ──────────────────────────────────────────────────────

  describe('A — pickup order totals', () => {
    const callId = uniqueVoiceCallId('test-delivery-a-pickup');

    beforeAll(() => setupCall(callId));

    it('create_order returns delivery_type pickup', async () => {
      const res = await toolCall(callId, 'create_order', {});
      expect(res.success).toBe(true);
      expect(res.delivery_type).toBe('pickup');
      expectUuid(res.order_id);
    });

    it('add_order_item returns subtotal_cents', async () => {
      const res = await toolCall(callId, 'add_order_item', {
        item_id: margheritaId,
        quantity: 2,
      });
      expect(res.success).toBe(true);
      // 2 × 850 = 1700
      expect(res.subtotal_cents).toBe(1700);
      expect(res.total_cents).toBe(1700);
    });

    it('confirm_order returns totals with delivery_fee_cents = 0', async () => {
      const res = await toolCall(callId, 'confirm_order', {});
      expect(res.success).toBe(true);
      expect(res.status).toBe('confirmed');
      expect(res.subtotal_cents).toBe(1700);
      expect(res.delivery_fee_cents).toBe(0);
      expect(res.total_cents).toBe(1700);
      expectUuid(res.order_id);
    });
  });

  // ── B: Delivery valid zone ───────────────────────────────────────────────

  describe('B — delivery valid zone', () => {
    const callId = uniqueVoiceCallId('test-delivery-b-valid');

    beforeAll(() => setupCall(callId));

    it('create_order with delivery_type = delivery', async () => {
      const res = await toolCall(callId, 'create_order', {
        delivery_type:        'delivery',
        customer_postal_code: '50667',
        customer_name:        'Hans Müller',
      });
      expect(res.success).toBe(true);
      expect(res.delivery_type).toBe('delivery');
    });

    it('add_order_item to reach min order', async () => {
      // 2 × 850 = 1700 ≥ 1500 min
      const res = await toolCall(callId, 'add_order_item', {
        item_id: margheritaId,
        quantity: 2,
      });
      expect(res.success).toBe(true);
      expect(res.subtotal_cents).toBe(1700);
    });

    it('confirm_order applies Zone A delivery fee (250 cents)', async () => {
      const res = await toolCall(callId, 'confirm_order', {});
      expect(res.success).toBe(true);
      expect(res.status).toBe('confirmed');
      expect(res.subtotal_cents).toBe(1700);
      expect(res.delivery_fee_cents).toBe(250);
      expect(res.total_cents).toBe(1950); // 1700 + 250
    });
  });

  // ── C: Min order not met ─────────────────────────────────────────────────

  describe('C — delivery min order not met', () => {
    const callId = uniqueVoiceCallId('test-delivery-c-minorder');

    let colaId;

    beforeAll(async () => {
      await setupCall(callId);
      // Get a cheap item (Cola ~ 280 cents)
      const res = await toolCall(callId, 'search_menu_item', { query: 'cola' });
      if (res.success && Array.isArray(res.items) && res.items.length > 0) {
        colaId = res.items[0].id;
      }
    });

    it('create_order with delivery to zone 50667', async () => {
      const res = await toolCall(callId, 'create_order', {
        delivery_type:        'delivery',
        customer_postal_code: '50667',
      });
      expect(res.success).toBe(true);
    });

    it('add one cola (280 cents < 1500 min)', async () => {
      if (!colaId) {
        // Fallback: add 1 margherita (850 < 1500)
        const res = await toolCall(callId, 'add_order_item', {
          item_id: margheritaId,
          quantity: 1,
        });
        expect(res.success).toBe(true);
        expect(res.subtotal_cents).toBeLessThan(1500);
      } else {
        const res = await toolCall(callId, 'add_order_item', {
          item_id: colaId,
          quantity: 1,
        });
        expect(res.success).toBe(true);
        expect(res.subtotal_cents).toBeLessThan(1500);
      }
    });

    it('confirm_order returns error min_order_not_met', async () => {
      const res = await toolCall(callId, 'confirm_order', {});
      expect(res.success).toBe(false);
      expect(res.error).toBe('min_order_not_met');
      expect(typeof res.min_order_cents).toBe('number');
      expect(res.min_order_cents).toBe(1500);
    });
  });

  // ── D: Invalid zone ──────────────────────────────────────────────────────

  describe('D — delivery invalid zone', () => {
    const callId = uniqueVoiceCallId('test-delivery-d-invalidzone');

    beforeAll(() => setupCall(callId));

    it('create_order with unknown postal code', async () => {
      const res = await toolCall(callId, 'create_order', {
        delivery_type:        'delivery',
        customer_postal_code: '99999',
      });
      expect(res.success).toBe(true);
    });

    it('add_order_item above min order amount', async () => {
      const res = await toolCall(callId, 'add_order_item', {
        item_id: margheritaId,
        quantity: 2,
      });
      expect(res.success).toBe(true);
    });

    it('confirm_order returns error delivery_zone_not_found', async () => {
      const res = await toolCall(callId, 'confirm_order', {});
      expect(res.success).toBe(false);
      expect(res.error).toBe('delivery_zone_not_found');
    });
  });

  // ── E: Recalculation after update ────────────────────────────────────────

  describe('E — recalculation after update_order_item', () => {
    const callId = uniqueVoiceCallId('test-delivery-e-recalc');

    beforeAll(() => setupCall(callId));

    it('create_order (pickup)', async () => {
      const res = await toolCall(callId, 'create_order', {});
      expect(res.success).toBe(true);
    });

    it('add_order_item quantity 1 → subtotal 850', async () => {
      const res = await toolCall(callId, 'add_order_item', {
        item_id: margheritaId,
        quantity: 1,
      });
      expect(res.success).toBe(true);
      expect(res.subtotal_cents).toBe(850);
    });

    it('update_order_item quantity 3 → subtotal 2550', async () => {
      const res = await toolCall(callId, 'update_order_item', {
        item_id:  margheritaId,
        quantity: 3,
      });
      expect(res.success).toBe(true);
      expect(res.subtotal_cents).toBe(2550);
      expect(res.total_cents).toBe(2550);
    });

    it('confirm_order reflects updated subtotal', async () => {
      const res = await toolCall(callId, 'confirm_order', {});
      expect(res.success).toBe(true);
      expect(res.subtotal_cents).toBe(2550);
      expect(res.delivery_fee_cents).toBe(0);
      expect(res.total_cents).toBe(2550);
    });
  });
});
