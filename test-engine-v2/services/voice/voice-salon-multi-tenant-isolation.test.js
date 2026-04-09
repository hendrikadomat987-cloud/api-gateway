'use strict';

/**
 * Voice — Same-Domain Multi-Tenant Isolation (Salon Track)
 *
 * Proves that two tenants running the same fachliche Domäne (salon)
 * are strictly isolated from each other — no cross-contamination of
 * services, stylists, bookings, or tool contexts.
 *
 * Tenant B — Salon Morgenlicht, Köln (00000000-…-0002)
 *   Signature data:   "Damenhaarschnitt" (bb000001-…-01, 6800 ct),
 *                     "Komplettfarbe" (14500 ct), "Ansatzfarbe"
 *                     Stylists: Anna Weber, Mehmet Kaya, Sofia Becker
 *
 * Tenant C — Studio Nord, Hamburg (00000000-…-0003)
 *   Signature data:   "Damen Schnitt & Style" (ff000001-…-01, 5500 ct),
 *                     "Balayage" (19900 ct, NOT in Morgenlicht),
 *                     "Keratin-Glättung" (NOT in Morgenlicht)
 *                     Stylists: Lena Fischer, Oliver Schmidt
 *
 * Tests:
 *   A. Morgenlicht get_services → only Morgenlicht data; never Studio Nord
 *   B. Studio Nord get_services → only Studio Nord data; never Morgenlicht
 *   C. Morgenlicht context rejects Studio Nord service_id (service_not_found)
 *   D. Studio Nord context rejects Morgenlicht service_id (service_not_found)
 *   E. Call list isolation: calls not visible across salon tenants
 *   F. Direct call/event read blocked cross-salon-tenants
 */

const config = require('../../config/config');
const {
  sendVoiceWebhook,
  listVoiceCalls,
  getVoiceCall,
  getVoiceCallEvents,
} = require('../../core/apiClient');
const {
  buildVapiStatusUpdate,
  buildVapiToolCall,
  uniqueVoiceCallId,
  VAPI_SALON_ASSISTANT_ID,
  VAPI_SALON_2_ASSISTANT_ID,
} = require('../../core/factories');

jest.setTimeout(120000);

// ── Tenant constants ──────────────────────────────────────────────────────────

const TOKEN_MORGENLICHT = config.tokens.tenantSalon;   // 00000000-…-0002
const TOKEN_STUDIO_NORD = config.tokens.tenantSalon2;  // 00000000-…-0003

const MORGENLICHT_TENANT_ID = '00000000-0000-0000-0000-000000000002';
const STUDIO_NORD_TENANT_ID = '00000000-0000-0000-0000-000000000003';

// ── Seed data identifiers (stable UUIDs from seed scripts) ─────────────────

// Morgenlicht — service IDs (bb-prefix)
const ML_SERVICE_DAMENHAARSCHNITT  = 'bb000001-0000-0000-0000-000000000001';
const ML_SERVICE_KOMPLETTFARBE     = 'bb000001-0000-0000-0000-000000000004';

// Studio Nord — service IDs (ff-prefix)
const SN_SERVICE_DAMEN_SCHNITT     = 'ff000001-0000-0000-0000-000000000001';
const SN_SERVICE_BALAYAGE          = 'ff000001-0000-0000-0000-000000000002';

// ── Known unique service names by tenant ──────────────────────────────────────
// These names appear ONLY in one tenant's catalogue — useful for leak detection.
const ML_ONLY_NAMES = ['Damenhaarschnitt', 'Komplettfarbe', 'Ansatzfarbe'];
const SN_ONLY_NAMES = ['Balayage', 'Keratin-Glättung', 'Fade Cut'];

// ── Session IDs for inline tool extraction ────────────────────────────────────
function toolResult(res) {
  const r = res.data?.results?.[0]?.result;
  if (!r) throw new Error(`No result in response: ${JSON.stringify(res.data)}`);
  return r;
}

// ─────────────────────────────────────────────────────────────────────────────

describe('voice / salon / same-domain multi-tenant isolation', () => {
  const ML_CALL_ID = uniqueVoiceCallId('smti-morgenlicht');
  const SN_CALL_ID = uniqueVoiceCallId('smti-studio-nord');

  let mlInternalId; // voice_calls.id for Morgenlicht call
  let snInternalId; // voice_calls.id for Studio Nord call

  // ── Setup: create one call per salon tenant ────────────────────────────────

  beforeAll(async () => {
    const resML = await sendVoiceWebhook(
      buildVapiStatusUpdate(ML_CALL_ID, {}, VAPI_SALON_ASSISTANT_ID),
    );
    if (resML.status >= 300) {
      throw new Error(`Setup: Morgenlicht webhook rejected with ${resML.status}: ${JSON.stringify(resML.data)}`);
    }

    const resSN = await sendVoiceWebhook(
      buildVapiStatusUpdate(SN_CALL_ID, {}, VAPI_SALON_2_ASSISTANT_ID),
    );
    if (resSN.status >= 300) {
      throw new Error(`Setup: Studio Nord webhook rejected with ${resSN.status}: ${JSON.stringify(resSN.data)}`);
    }

    const listML = await listVoiceCalls(TOKEN_MORGENLICHT);
    const callML = listML.data?.data?.find((c) => c.provider_call_id === ML_CALL_ID);
    if (!callML) throw new Error(`Setup: Morgenlicht call not found: ${ML_CALL_ID}`);
    mlInternalId = callML.id;

    const listSN = await listVoiceCalls(TOKEN_STUDIO_NORD);
    const callSN = listSN.data?.data?.find((c) => c.provider_call_id === SN_CALL_ID);
    if (!callSN) throw new Error(`Setup: Studio Nord call not found: ${SN_CALL_ID}`);
    snInternalId = callSN.id;
  });

  // ── A: Morgenlicht get_services — only Morgenlicht data ──────────────────

  describe('A — Morgenlicht get_services returns only Morgenlicht services', () => {
    let mlServices = [];

    it('get_services succeeds and returns Morgenlicht catalogue', async () => {
      const res = await sendVoiceWebhook(
        buildVapiToolCall(ML_CALL_ID, 'get_services', {}, VAPI_SALON_ASSISTANT_ID),
      );
      expect(res.status).toBe(200);

      const r = toolResult(res);
      expect(r.success).toBe(true);
      expect(Array.isArray(r.categories)).toBe(true);
      expect(r.categories.length).toBeGreaterThan(0);

      mlServices = r.categories.flatMap((c) => c.services ?? []);
      expect(mlServices.length).toBeGreaterThan(0);

      // Must contain Morgenlicht signature data
      const names = mlServices.map((s) => s.name);
      expect(names).toContain('Damenhaarschnitt');
    });

    it('Morgenlicht services list does NOT contain Studio Nord signature services', async () => {
      // Verify mlServices was populated by previous test
      if (mlServices.length === 0) throw new Error('Prerequisite: previous test must run first');

      const names = mlServices.map((s) => s.name);
      const ids   = mlServices.map((s) => s.id);

      // Studio Nord-only service names must not appear
      for (const snName of SN_ONLY_NAMES) {
        if (names.includes(snName)) {
          throw new Error(
            `DATA LEAK: Morgenlicht get_services returned Studio Nord service "${snName}".\n` +
            `Full service list: ${JSON.stringify(names)}`,
          );
        }
      }

      // Studio Nord service UUIDs must not appear
      if (ids.includes(SN_SERVICE_BALAYAGE)) {
        throw new Error(
          `DATA LEAK: Morgenlicht get_services returned Studio Nord service ID ${SN_SERVICE_BALAYAGE}`,
        );
      }
      if (ids.includes(SN_SERVICE_DAMEN_SCHNITT)) {
        throw new Error(
          `DATA LEAK: Morgenlicht get_services returned Studio Nord service ID ${SN_SERVICE_DAMEN_SCHNITT}`,
        );
      }

      // All returned services must belong to Morgenlicht (by tenant_id if returned)
      for (const svc of mlServices) {
        if (svc.tenant_id && svc.tenant_id !== MORGENLICHT_TENANT_ID) {
          throw new Error(
            `DATA LEAK: Morgenlicht get_services returned service with tenant_id=${svc.tenant_id}:\n` +
            JSON.stringify(svc),
          );
        }
      }
    });
  });

  // ── B: Studio Nord get_services — only Studio Nord data ──────────────────

  describe('B — Studio Nord get_services returns only Studio Nord services', () => {
    let snServices = [];

    it('get_services succeeds and returns Studio Nord catalogue', async () => {
      const res = await sendVoiceWebhook(
        buildVapiToolCall(SN_CALL_ID, 'get_services', {}, VAPI_SALON_2_ASSISTANT_ID),
      );
      expect(res.status).toBe(200);

      const r = toolResult(res);
      expect(r.success).toBe(true);
      expect(Array.isArray(r.categories)).toBe(true);
      expect(r.categories.length).toBeGreaterThan(0);

      snServices = r.categories.flatMap((c) => c.services ?? []);
      expect(snServices.length).toBeGreaterThan(0);

      // Must contain Studio Nord signature service
      const names = snServices.map((s) => s.name);
      expect(names).toContain('Balayage');
    });

    it('Studio Nord services list does NOT contain Morgenlicht signature services', async () => {
      if (snServices.length === 0) throw new Error('Prerequisite: previous test must run first');

      const names = snServices.map((s) => s.name);
      const ids   = snServices.map((s) => s.id);

      // Morgenlicht-only service names must not appear
      for (const mlName of ML_ONLY_NAMES) {
        if (names.includes(mlName)) {
          throw new Error(
            `DATA LEAK: Studio Nord get_services returned Morgenlicht service "${mlName}".\n` +
            `Full service list: ${JSON.stringify(names)}`,
          );
        }
      }

      // Morgenlicht service UUIDs must not appear
      if (ids.includes(ML_SERVICE_DAMENHAARSCHNITT)) {
        throw new Error(
          `DATA LEAK: Studio Nord get_services returned Morgenlicht service ID ${ML_SERVICE_DAMENHAARSCHNITT}`,
        );
      }

      // All returned services must belong to Studio Nord (by tenant_id if returned)
      for (const svc of snServices) {
        if (svc.tenant_id && svc.tenant_id !== STUDIO_NORD_TENANT_ID) {
          throw new Error(
            `DATA LEAK: Studio Nord get_services returned service with tenant_id=${svc.tenant_id}:\n` +
            JSON.stringify(svc),
          );
        }
      }
    });
  });

  // ── C: Morgenlicht rejects Studio Nord service_id ─────────────────────────

  describe('C — Morgenlicht add_booking_service rejects Studio Nord service_id', () => {
    it('using Studio Nord Balayage ID in Morgenlicht context → service_not_found', async () => {
      // Create a booking first so add_booking_service has context
      await sendVoiceWebhook(
        buildVapiToolCall(ML_CALL_ID, 'create_booking', {}, VAPI_SALON_ASSISTANT_ID),
      );

      const res = await sendVoiceWebhook(
        buildVapiToolCall(
          ML_CALL_ID,
          'add_booking_service',
          { service_id: SN_SERVICE_BALAYAGE },
          VAPI_SALON_ASSISTANT_ID,
        ),
      );
      expect(res.status).toBe(200);
      const r = toolResult(res);

      // Must fail — Balayage belongs to Studio Nord, not Morgenlicht
      expect(r.success).toBe(false);
      expect(r.error).toBe('service_not_found');

      // Negative: the booking must NOT have been modified with Studio Nord data
      expect(r.service).toBeUndefined();
      expect(r.booking_id).toBeUndefined();
    });

    it('using Studio Nord Damen Schnitt & Style ID in Morgenlicht context → service_not_found', async () => {
      const res = await sendVoiceWebhook(
        buildVapiToolCall(
          ML_CALL_ID,
          'add_booking_service',
          { service_id: SN_SERVICE_DAMEN_SCHNITT },
          VAPI_SALON_ASSISTANT_ID,
        ),
      );
      expect(res.status).toBe(200);
      const r = toolResult(res);
      expect(r.success).toBe(false);
      expect(r.error).toBe('service_not_found');
    });
  });

  // ── D: Studio Nord rejects Morgenlicht service_id ─────────────────────────

  describe('D — Studio Nord add_booking_service rejects Morgenlicht service_id', () => {
    it('using Morgenlicht Damenhaarschnitt ID in Studio Nord context → service_not_found', async () => {
      await sendVoiceWebhook(
        buildVapiToolCall(SN_CALL_ID, 'create_booking', {}, VAPI_SALON_2_ASSISTANT_ID),
      );

      const res = await sendVoiceWebhook(
        buildVapiToolCall(
          SN_CALL_ID,
          'add_booking_service',
          { service_id: ML_SERVICE_DAMENHAARSCHNITT },
          VAPI_SALON_2_ASSISTANT_ID,
        ),
      );
      expect(res.status).toBe(200);
      const r = toolResult(res);

      // Must fail — Damenhaarschnitt belongs to Morgenlicht, not Studio Nord
      expect(r.success).toBe(false);
      expect(r.error).toBe('service_not_found');
      expect(r.service).toBeUndefined();
    });

    it('using Morgenlicht Komplettfarbe ID in Studio Nord context → service_not_found', async () => {
      const res = await sendVoiceWebhook(
        buildVapiToolCall(
          SN_CALL_ID,
          'add_booking_service',
          { service_id: ML_SERVICE_KOMPLETTFARBE },
          VAPI_SALON_2_ASSISTANT_ID,
        ),
      );
      expect(res.status).toBe(200);
      const r = toolResult(res);
      expect(r.success).toBe(false);
      expect(r.error).toBe('service_not_found');
    });
  });

  // ── E: Call list isolation between two salon tenants ─────────────────────

  describe('E — call list isolation: each tenant sees only own calls', () => {
    it('Studio Nord token list does NOT contain Morgenlicht call', async () => {
      const res   = await listVoiceCalls(TOKEN_STUDIO_NORD);
      expect(res.status).toBe(200);
      const calls = res.data?.data ?? [];

      const leaked = calls.find(
        (c) => c.provider_call_id === ML_CALL_ID || c.id === mlInternalId,
      );
      if (leaked) {
        throw new Error(
          `DATA LEAK: Morgenlicht call appears in Studio Nord list.\n` +
          `provider_call_id: ${ML_CALL_ID}\nLeaked: ${JSON.stringify(leaked)}`,
        );
      }

      // No call in the list should belong to Morgenlicht tenant
      const wrongTenant = calls.find((c) => c.tenant_id === MORGENLICHT_TENANT_ID);
      if (wrongTenant) {
        throw new Error(
          `DATA LEAK: Studio Nord list contains a call with Morgenlicht tenant_id.\n` +
          `Leaked entry: ${JSON.stringify(wrongTenant)}`,
        );
      }
    });

    it('Morgenlicht token list does NOT contain Studio Nord call', async () => {
      const res   = await listVoiceCalls(TOKEN_MORGENLICHT);
      expect(res.status).toBe(200);
      const calls = res.data?.data ?? [];

      const leaked = calls.find(
        (c) => c.provider_call_id === SN_CALL_ID || c.id === snInternalId,
      );
      if (leaked) {
        throw new Error(
          `DATA LEAK: Studio Nord call appears in Morgenlicht list.\n` +
          `provider_call_id: ${SN_CALL_ID}\nLeaked: ${JSON.stringify(leaked)}`,
        );
      }

      const wrongTenant = calls.find((c) => c.tenant_id === STUDIO_NORD_TENANT_ID);
      if (wrongTenant) {
        throw new Error(
          `DATA LEAK: Morgenlicht list contains a call with Studio Nord tenant_id.\n` +
          `Leaked entry: ${JSON.stringify(wrongTenant)}`,
        );
      }
    });
  });

  // ── F: Direct call/event access blocked cross-salon-tenants ──────────────

  describe('F — direct call access blocked between the two salon tenants', () => {
    it('Studio Nord token cannot read Morgenlicht call by internal UUID', async () => {
      if (!mlInternalId) throw new Error('Prerequisite: mlInternalId not set');

      const res = await getVoiceCall(TOKEN_STUDIO_NORD, mlInternalId);

      const leaked =
        res.status === 200 &&
        res.data?.success === true &&
        res.data?.data?.id === mlInternalId;

      if (leaked) {
        throw new Error(
          `DATA LEAK: Studio Nord token can read Morgenlicht call.\n` +
          `call.id: ${mlInternalId}\nBody: ${JSON.stringify(res.data)}`,
        );
      }
    });

    it('Studio Nord token cannot read Morgenlicht call events', async () => {
      if (!mlInternalId) throw new Error('Prerequisite: mlInternalId not set');

      const res = await getVoiceCallEvents(TOKEN_STUDIO_NORD, mlInternalId);

      const leaked =
        res.status === 200 &&
        res.data?.success === true &&
        Array.isArray(res.data?.data) &&
        res.data.data.length > 0;

      if (leaked) {
        throw new Error(
          `DATA LEAK: Studio Nord token can read Morgenlicht events.\n` +
          `call.id: ${mlInternalId}\nEvent count: ${res.data.data.length}`,
        );
      }
    });

    it('Morgenlicht token cannot read Studio Nord call by internal UUID', async () => {
      if (!snInternalId) throw new Error('Prerequisite: snInternalId not set');

      const res = await getVoiceCall(TOKEN_MORGENLICHT, snInternalId);

      const leaked =
        res.status === 200 &&
        res.data?.success === true &&
        res.data?.data?.id === snInternalId;

      if (leaked) {
        throw new Error(
          `DATA LEAK: Morgenlicht token can read Studio Nord call.\n` +
          `call.id: ${snInternalId}\nBody: ${JSON.stringify(res.data)}`,
        );
      }
    });

    it('Morgenlicht token cannot read Studio Nord call events', async () => {
      if (!snInternalId) throw new Error('Prerequisite: snInternalId not set');

      const res = await getVoiceCallEvents(TOKEN_MORGENLICHT, snInternalId);

      const leaked =
        res.status === 200 &&
        res.data?.success === true &&
        Array.isArray(res.data?.data) &&
        res.data.data.length > 0;

      if (leaked) {
        throw new Error(
          `DATA LEAK: Morgenlicht token can read Studio Nord events.\n` +
          `call.id: ${snInternalId}\nEvent count: ${res.data.data.length}`,
        );
      }
    });
  });
});
