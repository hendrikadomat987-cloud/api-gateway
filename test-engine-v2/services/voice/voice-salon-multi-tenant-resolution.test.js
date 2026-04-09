'use strict';

/**
 * Voice — Same-Domain Tenant Resolution (Two Salon Tenants)
 *
 * Proves that the platform correctly resolves two voice calls on the SAME track
 * (salon) but for DIFFERENT tenants — based solely on the assistant ID in the
 * webhook payload.
 *
 * Tenant B — Morgenlicht (00000000-…-0002), assistant: test-salon-assistant-001
 * Tenant C — Studio Nord (00000000-…-0003), assistant: test-salon-2-assistant-001
 *
 * Invariants:
 *   A. Morgenlicht assistant → session.track_type = 'salon',
 *      session.tenant_id = Morgenlicht, correct service catalogue
 *   B. Studio Nord assistant → session.track_type = 'salon',
 *      session.tenant_id = Studio Nord, correct service catalogue
 *   C. Two concurrent salon calls — each scoped to its own tenant:
 *      the get_services result from call A never contains call B's data
 *   D. Each tenant's session is invisible to the other salon tenant's token
 */

const config = require('../../config/config');
const {
  sendVoiceWebhook,
  listVoiceCalls,
  getVoiceCall,
  getCallSession,
} = require('../../core/apiClient');
const {
  buildVapiStatusUpdate,
  buildVapiToolCall,
  uniqueVoiceCallId,
  VAPI_SALON_ASSISTANT_ID,
  VAPI_SALON_2_ASSISTANT_ID,
} = require('../../core/factories');
const { expectSuccess } = require('../../core/assertions');

jest.setTimeout(120000);

const TOKEN_MORGENLICHT = config.tokens.tenantSalon;
const TOKEN_STUDIO_NORD = config.tokens.tenantSalon2;

const MORGENLICHT_TENANT_ID = '00000000-0000-0000-0000-000000000002';
const STUDIO_NORD_TENANT_ID = '00000000-0000-0000-0000-000000000003';

// Signature service names — each exists only in one tenant's catalogue
const ML_ONLY_NAMES = ['Damenhaarschnitt', 'Komplettfarbe', 'Ansatzfarbe'];
const SN_ONLY_NAMES = ['Balayage', 'Keratin-Glättung', 'Fade Cut'];

// ─────────────────────────────────────────────────────────────────────────────

describe('voice / salon / same-domain tenant resolution', () => {
  // ── A: Morgenlicht assistant → Morgenlicht tenant ─────────────────────────

  describe('A — Morgenlicht assistant resolves to Morgenlicht tenant', () => {
    const CALL_ID = uniqueVoiceCallId('smtr-morgenlicht');
    let callId;

    beforeAll(async () => {
      const res = await sendVoiceWebhook(
        buildVapiStatusUpdate(CALL_ID, {}, VAPI_SALON_ASSISTANT_ID),
      );
      if (res.status >= 300) {
        throw new Error(`Setup A: Morgenlicht webhook rejected with ${res.status}: ${JSON.stringify(res.data)}`);
      }
      const list = await listVoiceCalls(TOKEN_MORGENLICHT);
      const call = list.data?.data?.find((c) => c.provider_call_id === CALL_ID);
      if (!call) throw new Error(`Setup A: call not found: ${CALL_ID}`);
      callId = call.id;
    });

    it('call has track_type = salon and tenant_id = Morgenlicht', async () => {
      const callRes = await getVoiceCall(TOKEN_MORGENLICHT, callId);
      const call    = expectSuccess(callRes);

      expect(call.track_type).toBe('salon');
      expect(call.tenant_id).toBe(MORGENLICHT_TENANT_ID);
      // Must NOT have been assigned to Studio Nord
      expect(call.tenant_id).not.toBe(STUDIO_NORD_TENANT_ID);
    });

    it('session has track_type = salon and tenant_id = Morgenlicht', async () => {
      const sessionRes = await getCallSession(TOKEN_MORGENLICHT, callId);
      const session    = expectSuccess(sessionRes);

      expect(session.track_type).toBe('salon');
      expect(session.tenant_id).toBe(MORGENLICHT_TENANT_ID);
      expect(session.tenant_id).not.toBe(STUDIO_NORD_TENANT_ID);
    });

    it('get_services returns Morgenlicht catalogue (contains Damenhaarschnitt, not Balayage)', async () => {
      const res = await sendVoiceWebhook(
        buildVapiToolCall(CALL_ID, 'get_services', {}, VAPI_SALON_ASSISTANT_ID),
      );
      expect(res.status).toBe(200);

      const r = res.data?.results?.[0]?.result;
      expect(r.success).toBe(true);

      const allServices = r.categories?.flatMap((c) => c.services ?? []) ?? [];
      const names = allServices.map((s) => s.name);

      // Morgenlicht signature must be present
      expect(names).toContain('Damenhaarschnitt');

      // Studio Nord signature must NOT be present
      for (const snName of SN_ONLY_NAMES) {
        if (names.includes(snName)) {
          throw new Error(
            `DATA LEAK: Morgenlicht get_services (via Morgenlicht assistant) returned ` +
            `Studio Nord service "${snName}".\nFull list: ${JSON.stringify(names)}`,
          );
        }
      }
    });

    it('Morgenlicht call NOT visible to Studio Nord token', async () => {
      const list  = await listVoiceCalls(TOKEN_STUDIO_NORD);
      const calls = list.data?.data ?? [];

      const leaked = calls.find((c) => c.provider_call_id === CALL_ID || c.id === callId);
      if (leaked) {
        throw new Error(
          `DATA LEAK: Morgenlicht call (${CALL_ID}) appears in Studio Nord list.\n` +
          `Leaked: ${JSON.stringify(leaked)}`,
        );
      }

      const directRes = await getVoiceCall(TOKEN_STUDIO_NORD, callId);
      const directLeak =
        directRes.status === 200 &&
        directRes.data?.success === true &&
        directRes.data?.data?.id === callId;
      if (directLeak) {
        throw new Error(
          `DATA LEAK: Studio Nord token can directly read Morgenlicht call.\n` +
          `call.id: ${callId}\nBody: ${JSON.stringify(directRes.data)}`,
        );
      }
    });
  });

  // ── B: Studio Nord assistant → Studio Nord tenant ─────────────────────────

  describe('B — Studio Nord assistant resolves to Studio Nord tenant', () => {
    const CALL_ID = uniqueVoiceCallId('smtr-studio-nord');
    let callId;

    beforeAll(async () => {
      const res = await sendVoiceWebhook(
        buildVapiStatusUpdate(CALL_ID, {}, VAPI_SALON_2_ASSISTANT_ID),
      );
      if (res.status >= 300) {
        throw new Error(`Setup B: Studio Nord webhook rejected with ${res.status}: ${JSON.stringify(res.data)}`);
      }
      const list = await listVoiceCalls(TOKEN_STUDIO_NORD);
      const call = list.data?.data?.find((c) => c.provider_call_id === CALL_ID);
      if (!call) throw new Error(`Setup B: call not found: ${CALL_ID}`);
      callId = call.id;
    });

    it('call has track_type = salon and tenant_id = Studio Nord', async () => {
      const callRes = await getVoiceCall(TOKEN_STUDIO_NORD, callId);
      const call    = expectSuccess(callRes);

      expect(call.track_type).toBe('salon');
      expect(call.tenant_id).toBe(STUDIO_NORD_TENANT_ID);
      expect(call.tenant_id).not.toBe(MORGENLICHT_TENANT_ID);
    });

    it('session has track_type = salon and tenant_id = Studio Nord', async () => {
      const sessionRes = await getCallSession(TOKEN_STUDIO_NORD, callId);
      const session    = expectSuccess(sessionRes);

      expect(session.track_type).toBe('salon');
      expect(session.tenant_id).toBe(STUDIO_NORD_TENANT_ID);
      expect(session.tenant_id).not.toBe(MORGENLICHT_TENANT_ID);
    });

    it('get_services returns Studio Nord catalogue (contains Balayage, not Damenhaarschnitt)', async () => {
      const res = await sendVoiceWebhook(
        buildVapiToolCall(CALL_ID, 'get_services', {}, VAPI_SALON_2_ASSISTANT_ID),
      );
      expect(res.status).toBe(200);

      const r = res.data?.results?.[0]?.result;
      expect(r.success).toBe(true);

      const allServices = r.categories?.flatMap((c) => c.services ?? []) ?? [];
      const names = allServices.map((s) => s.name);

      // Studio Nord signature must be present
      expect(names).toContain('Balayage');

      // Morgenlicht signature must NOT be present
      for (const mlName of ML_ONLY_NAMES) {
        if (names.includes(mlName)) {
          throw new Error(
            `DATA LEAK: Studio Nord get_services (via Studio Nord assistant) returned ` +
            `Morgenlicht service "${mlName}".\nFull list: ${JSON.stringify(names)}`,
          );
        }
      }
    });

    it('Studio Nord call NOT visible to Morgenlicht token', async () => {
      const list  = await listVoiceCalls(TOKEN_MORGENLICHT);
      const calls = list.data?.data ?? [];

      const leaked = calls.find((c) => c.provider_call_id === CALL_ID || c.id === callId);
      if (leaked) {
        throw new Error(
          `DATA LEAK: Studio Nord call (${CALL_ID}) appears in Morgenlicht list.\n` +
          `Leaked: ${JSON.stringify(leaked)}`,
        );
      }

      const directRes = await getVoiceCall(TOKEN_MORGENLICHT, callId);
      const directLeak =
        directRes.status === 200 &&
        directRes.data?.success === true &&
        directRes.data?.data?.id === callId;
      if (directLeak) {
        throw new Error(
          `DATA LEAK: Morgenlicht token can directly read Studio Nord call.\n` +
          `call.id: ${callId}\nBody: ${JSON.stringify(directRes.data)}`,
        );
      }
    });
  });

  // ── C: Two concurrent salon calls — exclusive data ─────────────────────────

  describe('C — concurrent salon calls receive exclusively tenant-scoped data', () => {
    const ML_CALL_ID = uniqueVoiceCallId('smtr-concurrent-ml');
    const SN_CALL_ID = uniqueVoiceCallId('smtr-concurrent-sn');
    let mlServices = [];
    let snServices = [];

    beforeAll(async () => {
      // Fire both calls in parallel
      await Promise.all([
        sendVoiceWebhook(buildVapiStatusUpdate(ML_CALL_ID, {}, VAPI_SALON_ASSISTANT_ID)),
        sendVoiceWebhook(buildVapiStatusUpdate(SN_CALL_ID, {}, VAPI_SALON_2_ASSISTANT_ID)),
      ]);

      // Fetch services from both concurrently
      const [resML, resSN] = await Promise.all([
        sendVoiceWebhook(buildVapiToolCall(ML_CALL_ID, 'get_services', {}, VAPI_SALON_ASSISTANT_ID)),
        sendVoiceWebhook(buildVapiToolCall(SN_CALL_ID, 'get_services', {}, VAPI_SALON_2_ASSISTANT_ID)),
      ]);

      const mlResult = resML.data?.results?.[0]?.result;
      const snResult = resSN.data?.results?.[0]?.result;

      if (mlResult?.success) {
        mlServices = mlResult.categories?.flatMap((c) => c.services ?? []) ?? [];
      }
      if (snResult?.success) {
        snServices = snResult.categories?.flatMap((c) => c.services ?? []) ?? [];
      }
    });

    it('concurrent Morgenlicht call returns no Studio Nord services', async () => {
      expect(mlServices.length).toBeGreaterThan(0);
      const names = mlServices.map((s) => s.name);
      const ids   = mlServices.map((s) => s.id);

      for (const snName of SN_ONLY_NAMES) {
        if (names.includes(snName)) {
          throw new Error(
            `DATA LEAK (concurrent): Morgenlicht received Studio Nord service "${snName}"`,
          );
        }
      }
      // Balayage ID check
      if (ids.some((id) => id.startsWith('ff'))) {
        throw new Error(
          `DATA LEAK (concurrent): Morgenlicht received services with Studio Nord ID prefix (ff-):\n` +
          JSON.stringify(ids.filter((id) => id.startsWith('ff'))),
        );
      }
    });

    it('concurrent Studio Nord call returns no Morgenlicht services', async () => {
      expect(snServices.length).toBeGreaterThan(0);
      const names = snServices.map((s) => s.name);
      const ids   = snServices.map((s) => s.id);

      for (const mlName of ML_ONLY_NAMES) {
        if (names.includes(mlName)) {
          throw new Error(
            `DATA LEAK (concurrent): Studio Nord received Morgenlicht service "${mlName}"`,
          );
        }
      }
      // Morgenlicht ID check
      if (ids.some((id) => id.startsWith('bb'))) {
        throw new Error(
          `DATA LEAK (concurrent): Studio Nord received services with Morgenlicht ID prefix (bb-):\n` +
          JSON.stringify(ids.filter((id) => id.startsWith('bb'))),
        );
      }
    });

    it('the two service lists have no overlapping service IDs', async () => {
      if (mlServices.length === 0 || snServices.length === 0) {
        throw new Error('Prerequisite: both service lists must be populated');
      }

      const mlIds = new Set(mlServices.map((s) => s.id));
      const snIds = new Set(snServices.map((s) => s.id));

      const overlap = [...mlIds].filter((id) => snIds.has(id));
      if (overlap.length > 0) {
        throw new Error(
          `DATA LEAK (concurrent): ${overlap.length} service ID(s) appear in BOTH salon tenants.\n` +
          `Overlapping IDs: ${JSON.stringify(overlap)}\n` +
          `This would indicate cross-tenant data contamination.`,
        );
      }
    });
  });
});
