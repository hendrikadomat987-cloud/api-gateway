'use strict';

/**
 * Voice — Restaurant Conversational Order Intelligence (Phase 5)
 *
 * Verifies that the ordering system handles natural conversational references:
 *
 *   A. Positional reference — "die zweite" updates the correct item
 *   B. Repeat item         — "nochmal" clones the last added item
 *   C. Remove item         — "die erste" removes the first item
 *   D. Name-based update   — fuzzy name match in update_order_item
 *   E. Order summary       — get_order_summary returns correct totals
 *   F. Remove by name      — remove_order_item by item name
 *   G. Edge cases          — empty order, out-of-bounds, ambiguous
 *
 * Seed data:
 *   Pizza Margherita: 850 cents
 *   Pizza Salami:     980 cents
 */

const config = require('../../config/config');
const { sendVoiceWebhook, listVoiceCalls } = require('../../core/apiClient');
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
    throw new Error(`Setup failed: ${res.status} ${JSON.stringify(res.data)}`);
  }
  const list = await listVoiceCalls(TOKEN);
  const call = list.data?.data?.find((c) => c.provider_call_id === callId);
  if (!call) throw new Error(`Call not found: ${callId}`);
  return call.id;
}

async function tool(callId, name, args) {
  const res = await sendVoiceWebhook(
    buildVapiToolCall(callId, name, args, VAPI_RESTAURANT_ASSISTANT_ID),
  );
  if (res.status !== 200) throw new Error(`${name} HTTP ${res.status}`);
  const results = res.data?.results;
  if (!Array.isArray(results) || results.length === 0) throw new Error(`${name} empty results`);
  return results[0].result;
}

// ─────────────────────────────────────────────────────────────────────────────

describe('voice / restaurant / conversation-db', () => {
  let margheritaId;
  let salamiId;

  beforeAll(async () => {
    const setupCallId = uniqueVoiceCallId('test-conv-setup');
    await setupCall(setupCallId);
    const mrRes = await tool(setupCallId, 'search_menu_item', { query: 'margherita' });
    const slRes = await tool(setupCallId, 'search_menu_item', { query: 'salami' });
    margheritaId = mrRes.items?.[0]?.id;
    salamiId     = slRes.items?.[0]?.id;
    if (!margheritaId || !salamiId) {
      throw new Error(`Could not resolve menu UUIDs: margherita=${margheritaId} salami=${salamiId}`);
    }
  });

  // ── A: Positional reference ─────────────────────────────────────────────

  describe('A — positional reference "die zweite"', () => {
    const callId = uniqueVoiceCallId('test-conv-a-positional');

    beforeAll(() => setupCall(callId));

    it('setup: create order and add two different items', async () => {
      await tool(callId, 'create_order', {});
      const r1 = await tool(callId, 'add_order_item', { item_id: margheritaId, quantity: 1 });
      const r2 = await tool(callId, 'add_order_item', { item_id: salamiId,     quantity: 1 });
      expect(r1.success).toBe(true);
      expect(r2.success).toBe(true);
    });

    it('update "die zweite" → updates Salami (index 1), not Margherita', async () => {
      const res = await tool(callId, 'update_order_item', {
        item_id:  'die zweite',
        quantity: 3,
      });
      expect(res.success).toBe(true);
      expect(res.status).toBe('item_updated');
      expect(res.item.quantity).toBe(3);
      // Should be the Salami (second item)
      expect(res.item.name.toLowerCase()).toContain('salami');
    });

    it('summary shows Margherita unchanged (qty 1) and Salami at qty 3', async () => {
      const res = await tool(callId, 'get_order_summary', {});
      expect(res.success).toBe(true);
      expect(res.item_count).toBe(2);

      const margherita = res.items.find((i) => i.name.toLowerCase().includes('margherita'));
      const salami     = res.items.find((i) => i.name.toLowerCase().includes('salami'));
      expect(margherita?.quantity).toBe(1);
      expect(salami?.quantity).toBe(3);
    });

    it('update "die erste" → updates Margherita (index 0)', async () => {
      const res = await tool(callId, 'update_order_item', {
        item_id:  'die erste',
        quantity: 2,
      });
      expect(res.success).toBe(true);
      expect(res.item.name.toLowerCase()).toContain('margherita');
      expect(res.item.quantity).toBe(2);
    });

    it('update "das letzte" → updates Salami again (last item)', async () => {
      const res = await tool(callId, 'update_order_item', {
        item_id:  'das letzte',
        quantity: 2,
      });
      expect(res.success).toBe(true);
      expect(res.item.name.toLowerCase()).toContain('salami');
      expect(res.item.quantity).toBe(2);
    });
  });

  // ── B: Repeat item (nochmal) ────────────────────────────────────────────

  describe('B — repeat item "nochmal"', () => {
    const callId = uniqueVoiceCallId('test-conv-b-nochmal');

    beforeAll(() => setupCall(callId));

    it('setup: add one Margherita', async () => {
      await tool(callId, 'create_order', {});
      const res = await tool(callId, 'add_order_item', { item_id: margheritaId, quantity: 1 });
      expect(res.success).toBe(true);
      expectUuid(res.item.id);
    });

    it('add_order_item "nochmal" → second Margherita added as new line', async () => {
      const res = await tool(callId, 'add_order_item', { item_id: 'nochmal' });
      expect(res.success).toBe(true);
      expect(res.status).toBe('item_added');
      expect(res.item.name.toLowerCase()).toContain('margherita');
      expectUuid(res.item.id);
    });

    it('summary has 2 separate line items, both Margherita', async () => {
      const res = await tool(callId, 'get_order_summary', {});
      expect(res.item_count).toBe(2);
      expect(res.items.every((i) => i.name.toLowerCase().includes('margherita'))).toBe(true);
      // Subtotal = 2 × 850 cents
      expect(res.subtotal_cents).toBe(1700);
    });

    it('"noch eins davon" also repeats last item', async () => {
      const res = await tool(callId, 'add_order_item', { item_id: 'noch eins davon' });
      expect(res.success).toBe(true);
      expect(res.item.name.toLowerCase()).toContain('margherita');
    });
  });

  // ── C: Remove item by position ──────────────────────────────────────────

  describe('C — remove_order_item by position', () => {
    const callId = uniqueVoiceCallId('test-conv-c-remove');

    beforeAll(() => setupCall(callId));

    it('setup: add Margherita then Salami', async () => {
      await tool(callId, 'create_order', {});
      await tool(callId, 'add_order_item', { item_id: margheritaId, quantity: 1 });
      await tool(callId, 'add_order_item', { item_id: salamiId,     quantity: 1 });
    });

    it('remove "die erste" → removes Margherita', async () => {
      const res = await tool(callId, 'remove_order_item', { item_id: 'die erste' });
      expect(res.success).toBe(true);
      expect(res.status).toBe('item_removed');
      expect(res.removed_item.name.toLowerCase()).toContain('margherita');
      expect(res.remaining_items).toBe(1);
    });

    it('summary now has only Salami', async () => {
      const res = await tool(callId, 'get_order_summary', {});
      expect(res.item_count).toBe(1);
      expect(res.items[0].name.toLowerCase()).toContain('salami');
    });

    it('subtotal_cents = 980 after removing Margherita', async () => {
      const res = await tool(callId, 'get_order_summary', {});
      expect(res.subtotal_cents).toBe(980);
    });
  });

  // ── D: Name-based fuzzy update ──────────────────────────────────────────

  describe('D — name-based fuzzy matching', () => {
    const callId = uniqueVoiceCallId('test-conv-d-name');

    beforeAll(() => setupCall(callId));

    it('setup: add Margherita by UUID', async () => {
      await tool(callId, 'create_order', {});
      const res = await tool(callId, 'add_order_item', { item_id: margheritaId, quantity: 1 });
      expect(res.success).toBe(true);
    });

    it('update with item_id "margherita" (lowercase) → finds the item', async () => {
      const res = await tool(callId, 'update_order_item', {
        item_id:  'margherita',
        quantity: 3,
      });
      expect(res.success).toBe(true);
      expect(res.item.quantity).toBe(3);
      expect(res.item.name.toLowerCase()).toContain('margherita');
    });

    it('update with item_id "pizza" → also resolves when only one pizza exists', async () => {
      const res = await tool(callId, 'update_order_item', {
        item_id:  'pizza',
        quantity: 2,
      });
      expect(res.success).toBe(true);
      expect(res.item.quantity).toBe(2);
    });
  });

  // ── E: Order summary totals ─────────────────────────────────────────────

  describe('E — get_order_summary totals', () => {
    const callId = uniqueVoiceCallId('test-conv-e-summary');

    beforeAll(() => setupCall(callId));

    it('summary on empty session returns has_order=false', async () => {
      const res = await tool(callId, 'get_order_summary', {});
      expect(res.success).toBe(true);
      expect(res.has_order).toBe(false);
      expect(res.subtotal_cents).toBe(0);
    });

    it('setup: add 2× Margherita + 1× Salami', async () => {
      await tool(callId, 'create_order', {});
      await tool(callId, 'add_order_item', { item_id: margheritaId, quantity: 2 });
      await tool(callId, 'add_order_item', { item_id: salamiId,     quantity: 1 });
    });

    it('summary returns correct item count and subtotal', async () => {
      const res = await tool(callId, 'get_order_summary', {});
      expect(res.success).toBe(true);
      expect(res.has_order).toBe(true);
      expect(res.item_count).toBe(2);

      // 2 × 850 + 1 × 980 = 2680 cents
      expect(res.subtotal_cents).toBe(2680);
      expect(res.total_cents).toBe(2680);
    });

    it('summary items have correct position numbers', async () => {
      const res = await tool(callId, 'get_order_summary', {});
      expect(res.items[0].position).toBe(1);
      expect(res.items[1].position).toBe(2);
    });

    it('summary item line_totals are correct', async () => {
      const res = await tool(callId, 'get_order_summary', {});
      const margherita = res.items.find((i) => i.name.toLowerCase().includes('margherita'));
      const salami     = res.items.find((i) => i.name.toLowerCase().includes('salami'));
      // 2 × 8.50 = 17.00
      expect(margherita?.line_total).toBeCloseTo(17.0, 2);
      // 1 × 9.80 = 9.80
      expect(salami?.line_total).toBeCloseTo(9.8, 2);
    });
  });

  // ── F: Remove by name ───────────────────────────────────────────────────

  describe('F — remove_order_item by name', () => {
    const callId = uniqueVoiceCallId('test-conv-f-remove-name');

    beforeAll(() => setupCall(callId));

    it('setup: add Margherita and Salami', async () => {
      await tool(callId, 'create_order', {});
      await tool(callId, 'add_order_item', { item_id: margheritaId, quantity: 1 });
      await tool(callId, 'add_order_item', { item_id: salamiId,     quantity: 1 });
    });

    it('remove by name "salami" → removes Salami', async () => {
      const res = await tool(callId, 'remove_order_item', { item_id: 'salami' });
      expect(res.success).toBe(true);
      expect(res.removed_item.name.toLowerCase()).toContain('salami');
      expect(res.remaining_items).toBe(1);
    });

    it('only Margherita remains', async () => {
      const res = await tool(callId, 'get_order_summary', {});
      expect(res.item_count).toBe(1);
      expect(res.items[0].name.toLowerCase()).toContain('margherita');
    });
  });

  // ── G: Edge cases ───────────────────────────────────────────────────────

  describe('G — edge cases', () => {
    const callId = uniqueVoiceCallId('test-conv-g-edge');

    beforeAll(() => setupCall(callId));

    it('remove from empty order returns error empty_order', async () => {
      const res = await tool(callId, 'remove_order_item', { item_id: 'die erste' });
      // No context yet
      expect(res.success).toBe(false);
    });

    it('setup: add one item', async () => {
      await tool(callId, 'create_order', {});
      await tool(callId, 'add_order_item', { item_id: margheritaId, quantity: 1 });
    });

    it('out-of-bounds reference returns error', async () => {
      const res = await tool(callId, 'update_order_item', {
        item_id:  'die dritte',   // only 1 item in order
        quantity: 2,
      });
      expect(res.success).toBe(false);
      expect(res.error).toBe('out_of_bounds');
    });

    it('unknown name returns item_not_found', async () => {
      const res = await tool(callId, 'update_order_item', {
        item_id:  'Schnitzel',
        quantity: 2,
      });
      expect(res.success).toBe(false);
      expect(res.error).toBe('item_not_found');
    });

    it('nochmal on empty order returns error', async () => {
      // Use a fresh call with no order
      const freshCallId = uniqueVoiceCallId('test-conv-g-nochmal-empty');
      await setupCall(freshCallId);
      const res = await tool(freshCallId, 'add_order_item', { item_id: 'nochmal' });
      expect(res.success).toBe(false);
      expect(res.error).toBe('empty_order');
    });
  });
});
