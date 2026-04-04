require('dotenv').config();
const { Client } = require('pg');

(async () => {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  const res = await client.query(`
    insert into voice_agents (
      tenant_id,
      voice_provider_id,
      provider_agent_id,
      name,
      language,
      status,
      track_scope
    )
    values (
      '11111111-1111-1111-1111-111111111111',
      '0b0c7c60-804c-4119-ad1e-df56c687fd2b',
      'test-restaurant-assistant-001',
      'Test Restaurant Assistant',
      null,
      'active',
      'restaurant'
    )
    on conflict (tenant_id, voice_provider_id, provider_agent_id)
    do update set
      name = excluded.name,
      status = excluded.status,
      track_scope = excluded.track_scope
    returning id, tenant_id, voice_provider_id, provider_agent_id, status, track_scope
  `);

  console.log(JSON.stringify(res.rows, null, 2));
  await client.end();
})().catch((err) => {
  console.error(err);
  process.exit(1);
});