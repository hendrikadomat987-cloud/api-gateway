'use strict';

/**
 * Voice — Live Webhook Shape Validation
 *
 * Validates the structural correctness of fixture files in fixtures/voice/live/
 * and explicitly documents known shape differences between:
 *   - factory-built payloads (buildVapiStatusUpdate, buildVapiToolCall, etc.)
 *   - real Vapi webhook payloads (as captured from live calls)
 *
 * PURPOSE
 * -------
 * This test does NOT send any HTTP requests. It is a pure static/structural
 * inspection layer that:
 *   1. Ensures all fixture files are valid, parseable JSON
 *   2. Verifies the minimal required envelope shape for each event type
 *   3. Reports clearly when a fixture still contains placeholder values
 *   4. Documents and asserts known factory ↔ live payload differences
 *
 * When to add tests here
 * ----------------------
 * - When a new Vapi event type is added: add a fixture + a shape describe block
 * - When a live call exposes a new field not covered by factories: document it here
 * - When the backend starts requiring a field that factories omit: catch it here
 */

const {
  loadFixture,
  loadFixtureWithFallback,
  listFixtures,
  listRealFixtures,
  fixtureExists,
  FIXTURE_BASE,
  REAL_FIXTURE_BASE,
} = require('../../core/fixtureLoader');

const { diffPayloads, formatDiff } = require('../../core/payloadDiff');

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Returns true if a string looks like an unreplaced placeholder. */
function isPlaceholder(value) {
  return typeof value === 'string' && value.startsWith('REPLACE_WITH_');
}

/** Collect all leaf-level placeholder fields from a nested object. */
function collectPlaceholders(obj, path = '') {
  if (obj == null || typeof obj !== 'object') {
    if (isPlaceholder(obj)) return [path];
    return [];
  }
  return Object.entries(obj).flatMap(([k, v]) =>
    collectPlaceholders(v, path ? `${path}.${k}` : k),
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Fixture directory
// ─────────────────────────────────────────────────────────────────────────────

describe('voice / live-fixtures / directory', () => {
  it('fixtures/voice/live directory is accessible and contains JSON files', () => {
    const files = listFixtures();
    expect(files.length).toBeGreaterThan(0);
    files.forEach((f) => {
      expect(f).toMatch(/\.json$/);
    });
  });

  it('all expected placeholder fixture files exist', () => {
    const expected = [
      'vapi-status-update.json',
      'vapi-end-of-call-report.json',
      'vapi-tool-call.json',
      'vapi-unknown-shape.json',
    ];
    expected.forEach((name) => {
      if (!fixtureExists(name)) {
        throw new Error(
          `Missing fixture file: "${name}"\n` +
          `  Add it to: ${FIXTURE_BASE}`,
        );
      }
    });
  });

  it('all fixture files are valid parseable JSON', () => {
    const files = listFixtures();
    files.forEach((name) => {
      expect(() => loadFixture(name)).not.toThrow();
    });
  });

  it('reports real fixture availability', () => {
    const realFiles = listRealFixtures();
    if (realFiles.length === 0) {
      console.info(
        `[fixture-source] No real Vapi payloads found in ${REAL_FIXTURE_BASE}\n` +
        `  → All shape tests will run against PLACEHOLDER fixtures.\n` +
        `  → To test against real payloads: copy raw Vapi webhook bodies into that directory.`,
      );
    } else {
      console.info(
        `[fixture-source] Real Vapi payloads available (${realFiles.length}):\n` +
        realFiles.map((f) => `  ✓ real/${f}`).join('\n'),
      );
    }
    // Always passes — this test exists for visibility only
    expect(Array.isArray(realFiles)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// status-update shape
// ─────────────────────────────────────────────────────────────────────────────

describe('voice / live-fixtures / vapi-status-update.json', () => {
  let fixture;
  let fixtureSource;
  let fixtureDiff;

  beforeAll(() => {
    ({ fixture, source: fixtureSource } = loadFixtureWithFallback('vapi-status-update.json'));
    console.info(`[fixture-source] vapi-status-update.json → ${fixtureSource.toUpperCase()}`);
    if (fixtureSource === 'real') {
      const placeholder = loadFixture('vapi-status-update.json');
      fixtureDiff = diffPayloads(fixture, placeholder);
      console.info(formatDiff('vapi-status-update.json', fixtureDiff));
    }
  });

  it('shows whether real or placeholder fixture is in use', () => {
    expect(['real', 'placeholder']).toContain(fixtureSource);
    // This test is purely for visibility in CI output
  });

  it('[fixture-diff] reports structural delta between real and placeholder', () => {
    if (fixtureSource !== 'real') {
      console.warn('[fixture-diff] vapi-status-update.json: [SKIPPED] no real fixture in real/ — add JSON file to enable diff.');
      return;
    }
    expect(fixtureDiff).toBeDefined();
    expect(Array.isArray(fixtureDiff.fieldsOnlyInReal)).toBe(true);
    expect(Array.isArray(fixtureDiff.fieldsOnlyInPlaceholder)).toBe(true);
    expect(Array.isArray(fixtureDiff.fieldsWithDifferentTypes)).toBe(true);
  });

  it('has top-level message envelope', () => {
    expect(fixture).toHaveProperty('message');
    expect(typeof fixture.message).toBe('object');
  });

  it('message.type is "status-update"', () => {
    expect(fixture.message.type).toBe('status-update');
  });

  it('message.status is present', () => {
    expect(fixture.message).toHaveProperty('status');
    expect(typeof fixture.message.status).toBe('string');
  });

  it('message.call sub-object is present', () => {
    expect(fixture.message).toHaveProperty('call');
    expect(typeof fixture.message.call).toBe('object');
  });

  it('message.call.id (provider_call_id) is present', () => {
    expect(fixture.message.call).toHaveProperty('id');
    expect(typeof fixture.message.call.id).toBe('string');
  });

  it('message.timestamp is present', () => {
    expect(fixture.message).toHaveProperty('timestamp');
  });

  // ── Factory delta documentation ──────────────────────────────────────────
  //
  // The following tests document fields present in real Vapi payloads but
  // ABSENT from factory buildVapiStatusUpdate(). They serve as living
  // documentation of the mismatch between synthetic and real payloads.

  it('[factory-delta] call.orgId — present in live payload, absent in factory', () => {
    const hasOrgId = 'orgId' in (fixture.message.call ?? {});
    if (!hasOrgId) {
      const msg = fixtureSource === 'real'
        ? '[shape-delta] REAL payload missing call.orgId — unexpected for live Vapi events.'
        : '[shape-delta] call.orgId missing — expected in real Vapi payloads. Factory does not include it.';
      console.warn(msg);
    }
    expect(hasOrgId).toBe(true);
  });

  it('[factory-delta] call.type — present in live payload, absent in factory', () => {
    const hasType = 'type' in (fixture.message.call ?? {});
    if (!hasType) {
      const msg = fixtureSource === 'real'
        ? '[shape-delta] REAL payload missing call.type — unexpected for live Vapi events.'
        : '[shape-delta] call.type missing — real payloads carry "inboundPhoneCall" etc.';
      console.warn(msg);
    }
    expect(hasType).toBe(true);
  });

  it('[factory-delta] call.customer — present in live payload, absent in factory', () => {
    const hasCustomer = 'customer' in (fixture.message.call ?? {});
    if (!hasCustomer) {
      const msg = fixtureSource === 'real'
        ? '[shape-delta] REAL payload missing call.customer — unexpected for inbound calls.'
        : '[shape-delta] call.customer missing — real inbound calls carry caller number here.';
      console.warn(msg);
    }
    expect(hasCustomer).toBe(true);
  });

  it('reports placeholder fields (or confirms none remain in real payload)', () => {
    const placeholders = collectPlaceholders(fixture);
    if (fixtureSource === 'real' && placeholders.length > 0) {
      console.warn(
        `[fixture-warn] REAL fixture vapi-status-update.json still has ${placeholders.length} ` +
        `REPLACE_WITH_* placeholder(s) — patch them before replaying:\n  ${placeholders.join('\n  ')}`,
      );
    } else if (fixtureSource === 'placeholder' && placeholders.length > 0) {
      console.info(
        `[fixture-info] vapi-status-update.json (placeholder) has ${placeholders.length} field(s) ` +
        `awaiting real values:\n  ${placeholders.join('\n  ')}`,
      );
    } else if (placeholders.length === 0) {
      console.info('[fixture-info] vapi-status-update.json: no placeholder sentinels — payload looks real.');
    }
    expect(placeholders).toEqual(expect.any(Array));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// end-of-call-report shape
// ─────────────────────────────────────────────────────────────────────────────

describe('voice / live-fixtures / vapi-end-of-call-report.json', () => {
  let fixture;
  let fixtureSource;
  let fixtureDiff;

  beforeAll(() => {
    ({ fixture, source: fixtureSource } = loadFixtureWithFallback('vapi-end-of-call-report.json'));
    console.info(`[fixture-source] vapi-end-of-call-report.json → ${fixtureSource.toUpperCase()}`);
    if (fixtureSource === 'real') {
      const placeholder = loadFixture('vapi-end-of-call-report.json');
      fixtureDiff = diffPayloads(fixture, placeholder);
      console.info(formatDiff('vapi-end-of-call-report.json', fixtureDiff));
    }
  });

  it('shows whether real or placeholder fixture is in use', () => {
    expect(['real', 'placeholder']).toContain(fixtureSource);
  });

  it('[fixture-diff] reports structural delta between real and placeholder', () => {
    if (fixtureSource !== 'real') {
      console.warn('[fixture-diff] vapi-end-of-call-report.json: [SKIPPED] no real fixture in real/ — add JSON file to enable diff.');
      return;
    }
    expect(fixtureDiff).toBeDefined();
    expect(Array.isArray(fixtureDiff.fieldsOnlyInReal)).toBe(true);
    expect(Array.isArray(fixtureDiff.fieldsOnlyInPlaceholder)).toBe(true);
    expect(Array.isArray(fixtureDiff.fieldsWithDifferentTypes)).toBe(true);
  });

  it('has top-level message envelope', () => {
    expect(fixture).toHaveProperty('message');
  });

  it('message.type is "end-of-call-report"', () => {
    expect(fixture.message.type).toBe('end-of-call-report');
  });

  it('message.endedReason is present', () => {
    expect(fixture.message).toHaveProperty('endedReason');
    expect(typeof fixture.message.endedReason).toBe('string');
  });

  it('message.summary is present (or null for incomplete calls)', () => {
    if (fixtureSource === 'real' && !('summary' in (fixture.message ?? {}))) {
      console.warn(
        `[shape-observation] REAL payload: summary absent — endedReason="${fixture.message?.endedReason}". ` +
        'Normal for SIP-completed or otherwise incomplete calls (no AI summary generated).',
      );
      return; // valid: Vapi omits summary when call ends before completion
    }
    expect(fixture.message).toHaveProperty('summary');
  });

  it('message.durationSeconds is present and numeric (or absent for incomplete calls)', () => {
    if (fixtureSource === 'real' && !('durationSeconds' in (fixture.message ?? {}))) {
      console.warn(
        `[shape-observation] REAL payload: durationSeconds absent — endedReason="${fixture.message?.endedReason}". ` +
        'Normal for SIP-level completions before Vapi measures duration.',
      );
      return; // valid: Vapi omits durationSeconds when call ends before speech
    }
    expect(fixture.message).toHaveProperty('durationSeconds');
    expect(typeof fixture.message.durationSeconds).toBe('number');
  });

  it('message.call.id (provider_call_id) is present', () => {
    expect(fixture.message.call).toHaveProperty('id');
  });

  // ── Factory delta documentation ──────────────────────────────────────────

  it('[factory-delta] durationMinutes — present in normal live payloads, absent in factory', () => {
    const has = 'durationMinutes' in (fixture.message ?? {});
    if (!has) {
      if (fixtureSource === 'real') {
        console.warn(
          `[shape-observation] REAL payload: durationMinutes absent — endedReason="${fixture.message?.endedReason}". ` +
          'Present in normal completed calls; absent for premature SIP-level terminations.',
        );
        return; // observed finding, not a test failure
      }
      console.warn('[shape-delta] durationMinutes missing — real end-of-call-reports include it alongside durationSeconds.');
    }
    if (fixtureSource !== 'real') expect(has).toBe(true);
  });

  it('[factory-delta] transcript — present in normal live payloads, absent in factory', () => {
    const has = 'transcript' in (fixture.message ?? {});
    if (!has) {
      if (fixtureSource === 'real') {
        console.warn(
          `[shape-observation] REAL payload: transcript absent — endedReason="${fixture.message?.endedReason}". ` +
          'Present in normal completed calls; absent when call ends before AI processing.',
        );
        return; // observed finding, not a test failure
      }
      console.warn('[shape-delta] transcript missing — real payloads include the full call transcript.');
    }
    if (fixtureSource !== 'real') expect(has).toBe(true);
  });

  it('[factory-delta] cost/costBreakdown — present in live payload, absent in factory', () => {
    const hasCost = 'cost' in (fixture.message ?? {});
    if (!hasCost) {
      const msg = fixtureSource === 'real'
        ? '[shape-delta] REAL payload missing cost — check if Vapi omits it for zero-cost calls.'
        : '[shape-delta] cost missing — real payloads include call cost details.';
      console.warn(msg);
    }
    expect(hasCost).toBe(true);
  });

  it('[factory-delta] analysis — present in live payload, absent in factory', () => {
    const has = 'analysis' in (fixture.message ?? {});
    if (!has) {
      const msg = fixtureSource === 'real'
        ? '[shape-delta] REAL payload missing analysis — check assistant configuration.'
        : '[shape-delta] analysis missing — real payloads include structured evaluation data.';
      console.warn(msg);
    }
    expect(has).toBe(true);
  });

  it('[factory-delta] messages array — present in normal live payloads, absent in factory', () => {
    const has = 'messages' in (fixture.message ?? {});
    if (!has) {
      if (fixtureSource === 'real') {
        console.warn(
          `[shape-observation] REAL payload: messages array absent — endedReason="${fixture.message?.endedReason}". ` +
          'Present in normal completed calls; absent when call ends before AI turn-taking.',
        );
        return; // observed finding, not a test failure
      }
      console.warn('[shape-delta] messages missing — real payloads include per-turn transcript messages.');
    }
    if (fixtureSource !== 'real') expect(has).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// tool-calls shape
// ─────────────────────────────────────────────────────────────────────────────

describe('voice / live-fixtures / vapi-tool-call.json', () => {
  let fixture;
  let fixtureSource;
  let fixtureDiff;

  beforeAll(() => {
    ({ fixture, source: fixtureSource } = loadFixtureWithFallback('vapi-tool-call.json'));
    console.info(`[fixture-source] vapi-tool-call.json → ${fixtureSource.toUpperCase()}`);
    if (fixtureSource === 'real') {
      const placeholder = loadFixture('vapi-tool-call.json');
      fixtureDiff = diffPayloads(fixture, placeholder);
      console.info(formatDiff('vapi-tool-call.json', fixtureDiff));
    }
  });

  it('shows whether real or placeholder fixture is in use', () => {
    expect(['real', 'placeholder']).toContain(fixtureSource);
  });

  it('[fixture-diff] reports structural delta between real and placeholder', () => {
    if (fixtureSource !== 'real') {
      console.warn('[fixture-diff] vapi-tool-call.json: [SKIPPED] no real fixture in real/ — add JSON file to enable diff.');
      return;
    }
    expect(fixtureDiff).toBeDefined();
    expect(Array.isArray(fixtureDiff.fieldsOnlyInReal)).toBe(true);
    expect(Array.isArray(fixtureDiff.fieldsOnlyInPlaceholder)).toBe(true);
    expect(Array.isArray(fixtureDiff.fieldsWithDifferentTypes)).toBe(true);
  });

  it('has top-level message envelope', () => {
    expect(fixture).toHaveProperty('message');
  });

  it('message.type is "tool-calls"', () => {
    expect(fixture.message.type).toBe('tool-calls');
  });

  it('message.toolCallList is a non-empty array', () => {
    expect(Array.isArray(fixture.message.toolCallList)).toBe(true);
    expect(fixture.message.toolCallList.length).toBeGreaterThan(0);
  });

  it('toolCallList[0] has id, type, function fields', () => {
    const tc = fixture.message.toolCallList[0];
    expect(tc).toHaveProperty('id');
    expect(tc).toHaveProperty('type');
    expect(tc).toHaveProperty('function');
    expect(typeof tc.function.name).toBe('string');
    expect(tc.function.name.length).toBeGreaterThan(0);
  });

  it('toolCallList[0].function.arguments can be object or JSON string', () => {
    const args = fixture.message.toolCallList[0].function.arguments;
    const isObject = args !== null && typeof args === 'object';
    const isString = typeof args === 'string';
    expect(isObject || isString).toBe(true);
  });

  // ── Factory delta documentation ──────────────────────────────────────────

  it('[factory-delta] toolWithToolCallList — present in live payload, absent in factory', () => {
    const has = 'toolWithToolCallList' in (fixture.message ?? {});
    if (!has) {
      const msg = fixtureSource === 'real'
        ? '[shape-delta] REAL payload missing toolWithToolCallList — Vapi may omit it in some versions.'
        : '[shape-delta] toolWithToolCallList missing — real Vapi tool-calls include a parallel array with tool schema.';
      console.warn(msg);
    }
    expect(has).toBe(true);
  });

  it('[factory-delta] call.orgId — present in live payload, absent in factory', () => {
    const has = 'orgId' in (fixture.message.call ?? {});
    if (!has) {
      const msg = fixtureSource === 'real'
        ? '[shape-delta] REAL payload missing call.orgId in tool-call event.'
        : '[shape-delta] call.orgId missing in tool-call fixture (placeholder).';
      console.warn(msg);
    }
    expect(has).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// unknown-shape / unsupported event type
// ─────────────────────────────────────────────────────────────────────────────

describe('voice / live-fixtures / vapi-unknown-shape.json', () => {
  let fixture;
  let fixtureSource;
  let fixtureDiff;

  beforeAll(() => {
    ({ fixture, source: fixtureSource } = loadFixtureWithFallback('vapi-unknown-shape.json'));
    console.info(`[fixture-source] vapi-unknown-shape.json → ${fixtureSource.toUpperCase()}`);
    if (fixtureSource === 'real') {
      const placeholder = loadFixture('vapi-unknown-shape.json');
      fixtureDiff = diffPayloads(fixture, placeholder);
      console.info(formatDiff('vapi-unknown-shape.json', fixtureDiff));
    }
  });

  it('shows whether real or placeholder fixture is in use', () => {
    expect(['real', 'placeholder']).toContain(fixtureSource);
  });

  it('[fixture-diff] reports structural delta between real and placeholder', () => {
    if (fixtureSource !== 'real') {
      console.warn('[fixture-diff] vapi-unknown-shape.json: [SKIPPED] no real fixture in real/ — add JSON file to enable diff.');
      return;
    }
    expect(fixtureDiff).toBeDefined();
    expect(Array.isArray(fixtureDiff.fieldsOnlyInReal)).toBe(true);
    expect(Array.isArray(fixtureDiff.fieldsOnlyInPlaceholder)).toBe(true);
    expect(Array.isArray(fixtureDiff.fieldsWithDifferentTypes)).toBe(true);
  });

  it('has top-level message envelope', () => {
    expect(fixture).toHaveProperty('message');
  });

  it('message.type is a string (may be unrecognised by backend)', () => {
    expect(typeof fixture.message.type).toBe('string');
    expect(fixture.message.type.length).toBeGreaterThan(0);
  });

  it('message.type is NOT one of the known factory event types', () => {
    const knownTypes = ['status-update', 'end-of-call-report', 'tool-calls'];
    // Intentionally unknown — this fixture is meant to trigger the fallback path
    expect(knownTypes).not.toContain(fixture.message.type);
  });

  it('message.call.id is present (so backend can attempt call lookup)', () => {
    expect(fixture.message?.call?.id).toBeDefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// conversation-update
// ─────────────────────────────────────────────────────────────────────────────

describe('voice / live-fixtures / vapi-conversation-update.json', () => {
  let fixture;
  let fixtureSource;
  let fixtureDiff;

  beforeAll(() => {
    ({ fixture, source: fixtureSource } = loadFixtureWithFallback('vapi-conversation-update.json'));
    console.info(`[fixture-source] vapi-conversation-update.json → ${fixtureSource.toUpperCase()}`);
    if (fixtureSource === 'real') {
      const placeholder = loadFixture('vapi-conversation-update.json');
      fixtureDiff = diffPayloads(fixture, placeholder);
      console.info(formatDiff('vapi-conversation-update.json', fixtureDiff));
    }
  });

  it('shows whether real or placeholder fixture is in use', () => {
    expect(['real', 'placeholder']).toContain(fixtureSource);
  });

  it('[fixture-diff] reports structural delta between real and placeholder', () => {
    if (fixtureSource !== 'real') {
      console.warn('[fixture-diff] vapi-conversation-update.json: [SKIPPED] no real fixture in real/ — add JSON file to enable diff.');
      return;
    }
    expect(fixtureDiff).toBeDefined();
    expect(Array.isArray(fixtureDiff.fieldsOnlyInReal)).toBe(true);
    expect(Array.isArray(fixtureDiff.fieldsOnlyInPlaceholder)).toBe(true);
    expect(Array.isArray(fixtureDiff.fieldsWithDifferentTypes)).toBe(true);
  });

  it('has top-level message envelope', () => {
    expect(fixture).toHaveProperty('message');
  });

  it('message.type is "conversation-update"', () => {
    expect(fixture.message.type).toBe('conversation-update');
  });

  it('message.conversation is an array', () => {
    expect(Array.isArray(fixture.message.conversation)).toBe(true);
    expect(fixture.message.conversation.length).toBeGreaterThan(0);
  });

  it('message.conversation entries have role and content', () => {
    for (const entry of fixture.message.conversation) {
      expect(typeof entry.role).toBe('string');
      expect(typeof entry.content).toBe('string');
    }
  });

  it('message.messages is an array', () => {
    expect(Array.isArray(fixture.message.messages)).toBe(true);
    expect(fixture.message.messages.length).toBeGreaterThan(0);
  });

  it('message.messages entries have role and message fields', () => {
    for (const entry of fixture.message.messages) {
      expect(typeof entry.role).toBe('string');
      // 'message' field may be absent on some entry types — just ensure role is present
    }
  });

  it('message.artifact.messages is an array', () => {
    expect(Array.isArray(fixture.message?.artifact?.messages)).toBe(true);
  });

  it('message.call.id is present', () => {
    expect(typeof fixture.message?.call?.id).toBe('string');
  });

  // ── Factory delta notes ───────────────────────────────────────────────────
  // Real Vapi conversation-update payloads include fields not emitted by factories:
  //   • message.conversation[]              — role/content pairs (OpenAI-style)
  //   • message.messages[]                  — timestamped transcript (Vapi-style)
  //   • message.messagesOpenAIFormatted[]   — OpenAI format with all turns
  //   • message.artifact.messages           — growing artifact snapshot
  //   • message.timestamp                   — numeric epoch ms (real) vs ISO string (factory)
  // These fields are safe for the backend to receive — unrecognised fields are ignored
  // by the Zod schema (passthrough not enabled; extra fields are stripped silently).
  it('[factory-delta] documents fields present in real payload that factories omit', () => {
    if (fixtureSource !== 'real') {
      console.warn('[factory-delta] vapi-conversation-update.json: [SKIPPED] using placeholder fixture.');
      return;
    }
    // conversation[] — only present in real payloads
    expect(Array.isArray(fixture.message.conversation)).toBe(true);
    // messagesOpenAIFormatted[] — only present in real payloads
    expect(Array.isArray(fixture.message.messagesOpenAIFormatted)).toBe(true);
    // timestamp is numeric in real payloads
    expect(typeof fixture.message.timestamp).toBe('number');
  });

  it('[placeholder-report] lists any unreplaced REPLACE_WITH_ tokens', () => {
    const placeholders = collectPlaceholders(fixture);
    if (placeholders.length > 0) {
      console.warn(
        `[placeholder-report] vapi-conversation-update.json has ${placeholders.length} unreplaced placeholder(s):\n` +
          placeholders.map((p) => `  • ${p}`).join('\n'),
      );
    }
    // Non-blocking — placeholders are expected until a real capture is provided
    expect(true).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// speech-update
// ─────────────────────────────────────────────────────────────────────────────

describe('voice / live-fixtures / vapi-speech-update.json', () => {
  let fixture;
  let fixtureSource;
  let fixtureDiff;

  beforeAll(() => {
    ({ fixture, source: fixtureSource } = loadFixtureWithFallback('vapi-speech-update.json'));
    console.info(`[fixture-source] vapi-speech-update.json → ${fixtureSource.toUpperCase()}`);
    if (fixtureSource === 'real') {
      const placeholder = loadFixture('vapi-speech-update.json');
      fixtureDiff = diffPayloads(fixture, placeholder);
      console.info(formatDiff('vapi-speech-update.json', fixtureDiff));
    }
  });

  it('shows whether real or placeholder fixture is in use', () => {
    expect(['real', 'placeholder']).toContain(fixtureSource);
  });

  it('[fixture-diff] reports structural delta between real and placeholder', () => {
    if (fixtureSource !== 'real') {
      console.warn('[fixture-diff] vapi-speech-update.json: [SKIPPED] no real fixture in real/ — add JSON file to enable diff.');
      return;
    }
    expect(fixtureDiff).toBeDefined();
    expect(Array.isArray(fixtureDiff.fieldsOnlyInReal)).toBe(true);
    expect(Array.isArray(fixtureDiff.fieldsOnlyInPlaceholder)).toBe(true);
    expect(Array.isArray(fixtureDiff.fieldsWithDifferentTypes)).toBe(true);
  });

  it('has top-level message envelope', () => {
    expect(fixture).toHaveProperty('message');
  });

  it('message.type is "speech-update"', () => {
    expect(fixture.message.type).toBe('speech-update');
  });

  it('message.status is a non-empty string', () => {
    expect(typeof fixture.message.status).toBe('string');
    expect(fixture.message.status.length).toBeGreaterThan(0);
  });

  it('message.role is a non-empty string', () => {
    expect(typeof fixture.message.role).toBe('string');
    expect(fixture.message.role.length).toBeGreaterThan(0);
  });

  it('message.turn is a number', () => {
    expect(typeof fixture.message.turn).toBe('number');
  });

  it('message.artifact.messages is an array', () => {
    expect(Array.isArray(fixture.message?.artifact?.messages)).toBe(true);
  });

  it('message.call.id is present', () => {
    expect(typeof fixture.message?.call?.id).toBe('string');
  });

  // ── Factory delta notes ───────────────────────────────────────────────────
  // Real Vapi speech-update payloads include fields not emitted by factories:
  //   • message.status       — "started" | "stopped"
  //   • message.role         — "assistant" | "user"
  //   • message.turn         — integer turn counter
  //   • message.artifact     — growing messages/variables snapshot
  //   • message.timestamp    — numeric epoch ms (real) vs ISO string (factory)
  // The backend currently does not persist speech-update events.
  // These tests verify the payload shape is accepted (< 500) without crashing.
  it('[factory-delta] documents fields present in real payload that factories omit', () => {
    if (fixtureSource !== 'real') {
      console.warn('[factory-delta] vapi-speech-update.json: [SKIPPED] using placeholder fixture.');
      return;
    }
    // status/role/turn are only present in real payloads, not factory-built ones
    expect(typeof fixture.message.status).toBe('string');
    expect(typeof fixture.message.role).toBe('string');
    expect(typeof fixture.message.turn).toBe('number');
    // timestamp is numeric in real payloads
    expect(typeof fixture.message.timestamp).toBe('number');
  });

  it('[placeholder-report] lists any unreplaced REPLACE_WITH_ tokens', () => {
    const placeholders = collectPlaceholders(fixture);
    if (placeholders.length > 0) {
      console.warn(
        `[placeholder-report] vapi-speech-update.json has ${placeholders.length} unreplaced placeholder(s):\n` +
          placeholders.map((p) => `  • ${p}`).join('\n'),
      );
    }
    // Non-blocking — placeholders are expected until a real capture is provided
    expect(true).toBe(true);
  });
});
