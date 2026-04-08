/**
 * seed-live-agents.js
 *
 * Seeds the real Vapi assistant IDs into voice_agents so that live Vapi
 * webhooks can be resolved to a tenant in the dev/staging environment.
 *
 * Background:
 *   Tenant resolution works via message.call.assistantId → voice_agents.provider_agent_id.
 *   The synthetic test fixtures use 'test-assistant-001' / 'test-restaurant-assistant-001',
 *   but real Vapi sends the actual Vapi assistant UUIDs. This script creates the
 *   corresponding rows (idempotently) for the dev tenant.
 *
 * Usage:
 *   node seed-live-agents.js
 *
 * Requires:
 *   DATABASE_URL set in backend/.env (same DB used by the server)
 */

require('dotenv').config();
const { Client } = require('pg');

// ── Real Vapi IDs observed in live-capture payloads ───────────────────────────
// Update these if your Vapi project uses different assistant UUIDs.
const LIVE_AGENTS = [
  {
    // Restaurant-track agent — live captures confirm this assistant handles
    // restaurant ordering (Pizza/Lieferung flow). Was incorrectly seeded as
    // 'booking'; corrected to 'restaurant' so RESTAURANT_TOOLS are resolved.
    provider_agent_id: '696456cd-bdd2-4957-8c29-b9133946b06a',
    name: 'Live Restaurant Assistant (real Vapi)',
    track_scope: 'restaurant',
  },
];

// ── Dev tenant / provider ─────────────────────────────────────────────────────
// Same tenant and voice_provider used by all other dev seed scripts.
const TENANT_ID         = '11111111-1111-1111-1111-111111111111';
const VOICE_PROVIDER_ID = '0b0c7c60-804c-4119-ad1e-df56c687fd2b';

(async () => {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  console.log(`Seeding ${LIVE_AGENTS.length} live agent(s) for tenant ${TENANT_ID}…\n`);

  for (const agent of LIVE_AGENTS) {
    const res = await client.query(
      `
      INSERT INTO voice_agents (
        tenant_id,
        voice_provider_id,
        provider_agent_id,
        name,
        language,
        status,
        track_scope
      )
      VALUES (
        $1, $2, $3, $4, NULL, 'active', $5
      )
      ON CONFLICT (tenant_id, voice_provider_id, provider_agent_id)
      DO UPDATE SET
        name       = EXCLUDED.name,
        status     = EXCLUDED.status,
        track_scope = EXCLUDED.track_scope
      RETURNING id, tenant_id, provider_agent_id, status, track_scope
      `,
      [TENANT_ID, VOICE_PROVIDER_ID, agent.provider_agent_id, agent.name, agent.track_scope],
    );

    console.log(`✓ ${agent.track_scope} — ${agent.provider_agent_id}`);
    console.log(JSON.stringify(res.rows[0], null, 2));
    console.log();
  }

  await client.end();
  console.log('Done.');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
