/**
 * seed-restaurant-modifiers.js
 *
 * Idempotently seeds the restaurant_menu_modifiers catalog for the dev tenant.
 * Safe to run multiple times — uses ON CONFLICT DO NOTHING.
 *
 * Usage:
 *   node seed-restaurant-modifiers.js
 *
 * Requires:
 *   DATABASE_URL set in backend/.env
 */

require('dotenv').config();
const { Client } = require('pg');

const TENANT_ID = '11111111-1111-1111-1111-111111111111';

const MODIFIERS = [
  { name: 'extra Käse',      type: 'add',       price_cents: 150 },
  { name: 'Champignons',     type: 'add',       price_cents: 120 },
  { name: 'Jalapeños',       type: 'add',       price_cents: 100 },
  { name: 'Zwiebeln',        type: 'remove',    price_cents:   0 },
  { name: 'Käse',            type: 'remove',    price_cents:   0 },
  { name: 'Knoblauch',       type: 'remove',    price_cents:   0 },
  { name: 'extra knusprig',  type: 'free_text', price_cents:   0 },
  { name: 'Sauce separat',   type: 'free_text', price_cents:   0 },
  { name: 'bitte halbieren', type: 'free_text', price_cents:   0 },
];

(async () => {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  // Must set tenant context for RLS
  await client.query(`SELECT set_config('app.current_tenant', $1, false)`, [TENANT_ID]);

  console.log(`Seeding ${MODIFIERS.length} modifier(s) for tenant ${TENANT_ID}…\n`);

  for (const mod of MODIFIERS) {
    const res = await client.query(
      `
      INSERT INTO restaurant_menu_modifiers (tenant_id, name, type, price_cents)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (tenant_id, name, type) DO NOTHING
      RETURNING id, name, type, price_cents
      `,
      [TENANT_ID, mod.name, mod.type, mod.price_cents],
    );

    if (res.rows.length > 0) {
      console.log(`✓ [${mod.type}] ${mod.name} (${mod.price_cents / 100} €)`);
    } else {
      console.log(`  (already exists) [${mod.type}] ${mod.name}`);
    }
  }

  await client.end();
  console.log('\nDone.');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
