'use strict';

/**
 * Voice — Restaurant Robustness DB (Phase 6)
 *
 * Tests that the restaurant ordering system handles errors, missing context,
 * invalid inputs, and illegal state transitions explicitly and deterministically.
 *
 *   A. No active order       — mutations on session without an order
 *   B. Empty order           — remove/nochmal on order with no items
 *   C. Out of bounds         — positional ref exceeds item count
 *   D. Ambiguous reference   — name matches multiple different items → candidates
 *   E. Invalid quantity      — quantity ≤ 0 or non-integer
 *   F. Confirm without items — empty order → blocked
 *   G. Update after confirm  — mutation on confirmed order → blocked
 *   H. Duplicate confirm     — second confirm → already_confirmed
 *   I. Delivery without PLZ  — confirm with delivery but no postal code
 *   J. Invalid delivery type — create_order with unknown delivery_type
 *   K. create_order idempotent — duplicate create returns existing order
 */

const config = require('../../config/config');
const { sendVoiceWebhook, listVoiceCalls } = require('../../core/apiClient');
const {
  buildVapiStatusUpdate,
  buildVapiToolCall,
  uniqueVoiceCallId,
  VAPI_RESTAURANT_ASSISTANT_ID,
} = require('../../core/factories');

// ─────────────────────────────────────────────────────────────────────────────

jest.setTimeout(120000);

const TOKEN = config.tokens.tenantA;

// ── helpers ───────────────────────────────────────────────────────────────────

async function setupCall(callId) {
  const res = await sendVoiceWebhook(
    buildVapiStatusUpdate(callId, {}, VAPI_RESTAURANT_ASSISTANT_ID),
  );
  if (res.status >= 300) throw new Error(`Setup failed: ${res.status}`);
  const list = await listVoiceCalls(TOKEN);
  const call = list.data?.data?.find((c) => c.provider_call_id === callId);
  if (!call) throw new Error(`Call not found: ${callId}`);
  return call.id;
}

async function tool(callId, name, args) {
  const res = await sendVoiceWebhook(
    buildVapiToolCall(callId, name, args, VAPI_RESTAURANT_ASSISTANT_ID),
  );
  if (res.status !== 200) throw new Error(`${name} HTTP ${res.status}: ${JSON.stringify(res.data)}`);
  const results = res.data?.results;
  if (!Array.isArray(results) || results.length === 0) throw new Error(`${name} empty results`);
  return results[0].result;
}

// ─────────────────────────────────────────────────────────────────────────────

describe('voice / restaurant / robustness-db', () => {
  let margheritaId;
  let salamiId;

  beforeAll(async () => {
    const setupCallId = uniqueVoiceCallId('test-robust-setup');
    await setupCall(setupCallId);
    const mr = await tool(setupCallId, 'search_menu_item', { query: 'margherita' });
    const sl = await tool(setupCallId, 'search_menu_item', { query: 'salami' });
    margheritaId = mr.items?.[0]?.id;
    salamiId     = sl.items?.[0]?.id;
    if (!margheritaId || !salamiId) throw new Error('Could not resolve test item UUIDs');
  });

  // ── A: No active order ──────────────────────────────────────────────────

  describe('A — mutations without an active order', () => {
    const callId = uniqueVoiceCallId('test-robust-a-noorder');
    beforeAll(() => setupCall(callId));

    it('update_order_item → no_active_order', async () => {
      const res = await tool(callId, 'update_order_item', { item_id: 'die erste', quantity: 2 });
      expect(res.success).toBe(false);
      expect(res.error).toBe('no_active_order');
    });

    it('remove_order_item → no_active_order', async () => {
      const res = await tool(callId, 'remove_order_item', { item_id: 'die erste' });
      expect(res.success).toBe(false);
      expect(res.error).toBe('no_active_order');
    });

    it('confirm_order → no_active_order', async () => {
      const res = await tool(callId, 'confirm_order', {});
      expect(res.success).toBe(false);
      expect(res.error).toBe('no_active_order');
    });
  });

  // ── B: Empty order ──────────────────────────────────────────────────────

  describe('B — operations on empty order', () => {
    const callId = uniqueVoiceCallId('test-robust-b-empty');
    beforeAll(() => setupCall(callId));

    it('setup: create order with no items', async () => {
      const res = await tool(callId, 'create_order', {});
      expect(res.success).toBe(true);
    });

    it('remove_order_item → empty_order', async () => {
      const res = await tool(callId, 'remove_order_item', { item_id: 'die erste' });
      expect(res.success).toBe(false);
      expect(res.error).toBe('empty_order');
    });

    it('add_order_item "nochmal" → empty_order', async () => {
      const res = await tool(callId, 'add_order_item', { item_id: 'nochmal' });
      expect(res.success).toBe(false);
      expect(res.error).toBe('empty_order');
    });
  });

  // ── C: Out of bounds ────────────────────────────────────────────────────

  describe('C — out-of-bounds positional reference', () => {
    const callId = uniqueVoiceCallId('test-robust-c-oob');
    beforeAll(() => setupCall(callId));

    it('setup: create order with 1 item', async () => {
      await tool(callId, 'create_order', {});
      await tool(callId, 'add_order_item', { item_id: margheritaId, quantity: 1 });
    });

    it('"die zweite" on 1-item order → out_of_bounds', async () => {
      const res = await tool(callId, 'update_order_item', { item_id: 'die zweite', quantity: 2 });
      expect(res.success).toBe(false);
      expect(res.error).toBe('out_of_bounds');
    });

    it('"die dritte" on 1-item order → out_of_bounds', async () => {
      const res = await tool(callId, 'remove_order_item', { item_id: 'die dritte' });
      expect(res.success).toBe(false);
      expect(res.error).toBe('out_of_bounds');
    });
  });

  // ── D: Ambiguous reference ──────────────────────────────────────────────

  describe('D — ambiguous reference returns candidates', () => {
    const callId = uniqueVoiceCallId('test-robust-d-ambig');
    beforeAll(() => setupCall(callId));

    it('setup: add Margherita and Salami (both are "Pizza")', async () => {
      await tool(callId, 'create_order', {});
      await tool(callId, 'add_order_item', { item_id: margheritaId, quantity: 1 });
      await tool(callId, 'add_order_item', { item_id: salamiId,     quantity: 1 });
    });

    it('update with "pizza" → ambiguous_reference with candidates list', async () => {
      const res = await tool(callId, 'update_order_item', { item_id: 'pizza', quantity: 3 });
      expect(res.success).toBe(false);
      expect(res.error).toBe('ambiguous_reference');
      // candidates must list both matching items
      expect(Array.isArray(res.candidates)).toBe(true);
      expect(res.candidates.length).toBeGreaterThanOrEqual(2);
      const names = res.candidates.map((c) => c.name.toLowerCase());
      expect(names.some((n) => n.includes('margherita'))).toBe(true);
      expect(names.some((n) => n.includes('salami'))).toBe(true);
    });

    it('remove with "pizza" → ambiguous_reference with candidates', async () => {
      const res = await tool(callId, 'remove_order_item', { item_id: 'pizza' });
      expect(res.success).toBe(false);
      expect(res.error).toBe('ambiguous_reference');
      expect(Array.isArray(res.candidates)).toBe(true);
      expect(res.candidates.length).toBeGreaterThanOrEqual(2);
    });

    it('update with specific name "margherita" → resolves unambiguously', async () => {
      const res = await tool(callId, 'update_order_item', { item_id: 'margherita', quantity: 2 });
      expect(res.success).toBe(true);
      expect(res.item.name.toLowerCase()).toContain('margherita');
    });
  });

  // ── E: Invalid quantity ─────────────────────────────────────────────────

  describe('E — invalid quantity values', () => {
    const callId = uniqueVoiceCallId('test-robust-e-qty');
    beforeAll(() => setupCall(callId));

    it('setup: create order with 1 item', async () => {
      await tool(callId, 'create_order', {});
      await tool(callId, 'add_order_item', { item_id: margheritaId, quantity: 1 });
    });

    it('add_order_item quantity=0 → invalid_quantity', async () => {
      const res = await tool(callId, 'add_order_item', { item_id: margheritaId, quantity: 0 });
      expect(res.success).toBe(false);
      expect(res.error).toBe('invalid_quantity');
    });

    it('add_order_item quantity=-1 → invalid_quantity', async () => {
      const res = await tool(callId, 'add_order_item', { item_id: margheritaId, quantity: -1 });
      expect(res.success).toBe(false);
      expect(res.error).toBe('invalid_quantity');
    });

    it('update_order_item quantity=0 → invalid_quantity', async () => {
      const res = await tool(callId, 'update_order_item', { item_id: margheritaId, quantity: 0 });
      expect(res.success).toBe(false);
      expect(res.error).toBe('invalid_quantity');
    });

    it('update_order_item quantity=-5 → invalid_quantity', async () => {
      const res = await tool(callId, 'update_order_item', { item_id: margheritaId, quantity: -5 });
      expect(res.success).toBe(false);
      expect(res.error).toBe('invalid_quantity');
    });

    it('valid quantity=3 still works after failed attempts', async () => {
      const res = await tool(callId, 'update_order_item', { item_id: margheritaId, quantity: 3 });
      expect(res.success).toBe(true);
      expect(res.item.quantity).toBe(3);
    });
  });

  // ── F: Confirm without items ────────────────────────────────────────────

  describe('F — confirm empty order', () => {
    const callId = uniqueVoiceCallId('test-robust-f-emptyconfirm');
    beforeAll(() => setupCall(callId));

    it('create_order without any items', async () => {
      const res = await tool(callId, 'create_order', {});
      expect(res.success).toBe(true);
    });

    it('confirm_order with no items → empty_order error', async () => {
      const res = await tool(callId, 'confirm_order', {});
      expect(res.success).toBe(false);
      expect(res.error).toBe('empty_order');
    });
  });

  // ── G: Update after confirm ─────────────────────────────────────────────

  describe('G — mutations after confirm are blocked', () => {
    const callId = uniqueVoiceCallId('test-robust-g-postconfirm');
    beforeAll(() => setupCall(callId));

    it('setup: full order lifecycle to confirmed state', async () => {
      await tool(callId, 'create_order', {});
      await tool(callId, 'add_order_item', { item_id: margheritaId, quantity: 1 });
      const confirm = await tool(callId, 'confirm_order', {});
      expect(confirm.success).toBe(true);
      expect(confirm.status).toBe('confirmed');
    });

    it('add_order_item after confirm → order_already_confirmed', async () => {
      const res = await tool(callId, 'add_order_item', { item_id: margheritaId, quantity: 1 });
      expect(res.success).toBe(false);
      expect(res.error).toBe('order_already_confirmed');
    });

    it('update_order_item after confirm → order_already_confirmed', async () => {
      const res = await tool(callId, 'update_order_item', { item_id: 'die erste', quantity: 3 });
      expect(res.success).toBe(false);
      expect(res.error).toBe('order_already_confirmed');
    });

    it('remove_order_item after confirm → order_already_confirmed', async () => {
      const res = await tool(callId, 'remove_order_item', { item_id: 'die erste' });
      expect(res.success).toBe(false);
      expect(res.error).toBe('order_already_confirmed');
    });
  });

  // ── H: Duplicate confirm ────────────────────────────────────────────────

  describe('H — duplicate confirm is blocked cleanly', () => {
    const callId = uniqueVoiceCallId('test-robust-h-dupconfirm');
    beforeAll(() => setupCall(callId));

    it('setup: order and first confirm', async () => {
      await tool(callId, 'create_order', {});
      await tool(callId, 'add_order_item', { item_id: margheritaId, quantity: 1 });
      const c1 = await tool(callId, 'confirm_order', {});
      expect(c1.success).toBe(true);
    });

    it('second confirm → already_confirmed (not a crash, not silent re-confirm)', async () => {
      const c2 = await tool(callId, 'confirm_order', {});
      expect(c2.success).toBe(false);
      expect(c2.error).toBe('already_confirmed');
    });
  });

  // ── I: Delivery without postal code ────────────────────────────────────

  describe('I — delivery order without postal code blocked at confirm', () => {
    const callId = uniqueVoiceCallId('test-robust-i-noplz');
    beforeAll(() => setupCall(callId));

    it('create_order with delivery_type=delivery but no postal code', async () => {
      const res = await tool(callId, 'create_order', { delivery_type: 'delivery' });
      expect(res.success).toBe(true);
      expect(res.delivery_type).toBe('delivery');
    });

    it('add item to meet minimum order', async () => {
      const res = await tool(callId, 'add_order_item', { item_id: margheritaId, quantity: 2 });
      expect(res.success).toBe(true);
    });

    it('confirm → delivery_postal_code_missing', async () => {
      const res = await tool(callId, 'confirm_order', {});
      expect(res.success).toBe(false);
      expect(res.error).toBe('delivery_postal_code_missing');
    });
  });

  // ── J: Invalid delivery type ────────────────────────────────────────────

  describe('J — invalid delivery_type rejected at create_order', () => {
    const callId = uniqueVoiceCallId('test-robust-j-badtype');
    beforeAll(() => setupCall(callId));

    it('create_order with delivery_type="express" → invalid_delivery_type', async () => {
      const res = await tool(callId, 'create_order', { delivery_type: 'express' });
      expect(res.success).toBe(false);
      expect(res.error).toBe('invalid_delivery_type');
    });

    it('create_order with delivery_type="drone" → invalid_delivery_type', async () => {
      const res = await tool(callId, 'create_order', { delivery_type: 'drone' });
      expect(res.success).toBe(false);
      expect(res.error).toBe('invalid_delivery_type');
    });

    it('create_order with valid delivery_type="pickup" still works', async () => {
      const res = await tool(callId, 'create_order', { delivery_type: 'pickup' });
      expect(res.success).toBe(true);
      expect(res.delivery_type).toBe('pickup');
    });
  });

  // ── K: create_order idempotency ─────────────────────────────────────────

  describe('K — duplicate create_order reuses existing draft', () => {
    const callId = uniqueVoiceCallId('test-robust-k-idempotent');
    beforeAll(() => setupCall(callId));

    let firstOrderId;

    it('first create_order → status=created', async () => {
      const res = await tool(callId, 'create_order', {});
      expect(res.success).toBe(true);
      expect(res.status).toBe('created');
      firstOrderId = res.order_id;
    });

    it('add item to existing draft', async () => {
      await tool(callId, 'add_order_item', { item_id: margheritaId, quantity: 1 });
    });

    it('second create_order → status=reused, same order_id, items preserved', async () => {
      const res = await tool(callId, 'create_order', {});
      expect(res.success).toBe(true);
      expect(res.status).toBe('reused');
      expect(res.order_id).toBe(firstOrderId);
    });

    it('items still present after idempotent create', async () => {
      const summary = await tool(callId, 'get_order_summary', {});
      expect(summary.item_count).toBe(1);
    });
  });
});
