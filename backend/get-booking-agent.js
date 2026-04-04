require('dotenv').config();
const { Client } = require('pg');

(async () => {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  const res = await client.query(`
    select id, tenant_id, voice_provider_id, language, status
    from voice_agents
    where provider_agent_id = 'test-assistant-001'
    limit 1
  `);

  console.log(JSON.stringify(res.rows, null, 2));
  await client.end();
})().catch((err) => {
  console.error(err);
  process.exit(1);
});