'use strict';

/**
 * Voice — Session Discovery
 *
 * Verifies that GET /voice/calls/:id/session returns the active session
 * for a call identified by its internal UUID.
 */

const config = require('../../config/config');

const {
  sendVoiceWebhook,
  listVoiceCalls,
  getCallSession,
  getVoiceSession,
  getVoiceCall,
  postVoiceFallback,
} = require('../../core/apiClient');

const {
  buildVapiStatusUpdate,
  uniqueVoiceCallId,
} = require('../../core/factories');

const { expectSuccess, expectError, expectUnauthorized, assertTenantIsolationFailure } = require('../../core/assertions');

// ─────────────────────────────────────────────────────────────────────────────

const TOKEN            = config.tokens.tenantA;
const PROVIDER_CALL_ID = uniqueVoiceCallId('test-call-session-discovery');

// ─────────────────────────────────────────────────────────────────────────────

describe('voice / session-discovery', () => {
  let internalCallId;

  beforeAll(async () => {
    const res = await sendVoiceWebhook(buildVapiStatusUpdate(PROVIDER_CALL_ID));
    if (res.status >= 300) {
      throw new Error(
        `Setup failed — webhook rejected with ${res.status}.\n` +
        `provider_call_id: ${PROVIDER_CALL_ID}\n` +
        `Response: ${JSON.stringify(res.data)}`,
      );
    }

    const list = await listVoiceCalls(TOKEN);
    if (list.status !== 200 || !list.data?.success) {
      throw new Error(`Setup failed — GET /voice/calls returned ${list.status}`);
    }
    const call = list.data.data.find((c) => c.provider_call_id === PROVIDER_CALL_ID);
    if (!call) {
      throw new Error(
        `Setup failed — call not found in list after webhook.\n` +
        `provider_call_id: ${PROVIDER_CALL_ID}`,
      );
    }
    internalCallId = call.id;
  });

  it('GET /voice/calls/:id/session → returns the active session for the call', async () => {
    const res     = await getCallSession(TOKEN, internalCallId);
    const session = expectSuccess(res);

    expect(session.id).toBeDefined();
    expect(session.voice_call_id).toBe(internalCallId);
    expect(session.status).toBe('active');
  });

  it('GET /voice/calls/:id/session — no token → 401, invalid token → 401', async () => {
    const noToken      = await getCallSession('', internalCallId);
    const invalidToken = await getCallSession(config.tokens.invalid, internalCallId);

    expectUnauthorized(noToken);
    expectUnauthorized(invalidToken);
  });

  it('Tenant B cannot read Tenant A session via call discovery', async () => {
    const res = await getCallSession(config.tokens.tenantB, internalCallId);
    assertTenantIsolationFailure(res, internalCallId);
  });

  it('POST /voice/sessions/:id/fallback → session and call transition to fallback', async () => {
    // Fresh call + session — must not share state with the 'active' discovery tests above
    const fallbackCallId = uniqueVoiceCallId('test-call-fallback');

    const webhookRes = await sendVoiceWebhook(buildVapiStatusUpdate(fallbackCallId));
    if (webhookRes.status >= 300) {
      throw new Error(`Fallback setup — webhook rejected: ${JSON.stringify(webhookRes.data)}`);
    }

    const list = await listVoiceCalls(TOKEN);
    const call = list.data.data.find((c) => c.provider_call_id === fallbackCallId);
    if (!call) throw new Error(`Fallback setup — call not found: ${fallbackCallId}`);

    const discoveryRes = await getCallSession(TOKEN, call.id);
    const session      = expectSuccess(discoveryRes);

    const fallbackRes     = await postVoiceFallback(TOKEN, session.id);
    const updatedSession  = expectSuccess(fallbackRes);

    expect(updatedSession.status).toBe('fallback');

    const callRes     = await getVoiceCall(TOKEN, call.id);
    const updatedCall = expectSuccess(callRes);

    expect(updatedCall.status).toBe('fallback');
  });

  it('POST /voice/sessions/:id/fallback — unknown session ID → 404 VOICE_SESSION_NOT_FOUND', async () => {
    const res = await postVoiceFallback(TOKEN, '00000000-0000-0000-0000-000000000000');
    expectError(res, 404, 'VOICE_SESSION_NOT_FOUND');
  });

  it('POST /voice/sessions/:id/fallback — no token → 401, invalid token → 401', async () => {
    const probeId = '00000000-0000-0000-0000-000000000000';

    const noToken      = await postVoiceFallback('', probeId);
    const invalidToken = await postVoiceFallback(config.tokens.invalid, probeId);

    expectUnauthorized(noToken);
    expectUnauthorized(invalidToken);
  });

  it('GET /voice/sessions/:id → returns the same session resolved via call discovery', async () => {
    const discoveryRes = await getCallSession(TOKEN, internalCallId);
    const discovered   = expectSuccess(discoveryRes);

    const res     = await getVoiceSession(TOKEN, discovered.id);
    const session = expectSuccess(res);

    expect(session.id).toBe(discovered.id);
    expect(session.voice_call_id).toBe(internalCallId);
  });
});
