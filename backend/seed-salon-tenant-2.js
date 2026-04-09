/**
 * seed-salon-tenant-2.js
 *
 * Seeds Tenant 3 — Studio Nord, Hamburg.
 * Second salon tenant — same domain as Morgenlicht, distinct data.
 *
 * Deliberately different from Morgenlicht so cross-tenant tests can detect leaks:
 *   - Different stylist names (Lena Fischer, Oliver Schmidt)
 *   - Different service names and prices (Balayage, Glättung, Fade)
 *   - Different working hours (Mon–Fri instead of Tue–Sat)
 *   - Different salon city (Hamburg vs. Köln)
 *   - Fixed UUIDs using cc/ff/gg prefixes (bb/aa/dd prefixes are Morgenlicht)
 *
 * Idempotent: uses fixed UUIDs + ON CONFLICT … DO UPDATE throughout.
 * Safe to re-run on an existing tenant without duplicating data.
 *
 * Prerequisites:
 *   - Same migrations as seed-salon-tenant.js applied
 *   - DATABASE_URL set in environment or .env
 *   - A voice_providers row must exist for TENANT_ID (or voice agent step is skipped)
 *
 * Usage:
 *   DATABASE_URL=... \
 *   TENANT_ID=00000000-0000-0000-0000-000000000003 \
 *   VAPI_SALON_2_ASSISTANT_ID=test-salon-2-assistant-001 \
 *   node backend/seed-salon-tenant-2.js
 */

'use strict';

require('dotenv').config();
const { Pool } = require('pg');
const { provisionTenantDomains } = require('./lib/provision-tenant-domains');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// ── Config ────────────────────────────────────────────────────────────────────

const TENANT_ID                 = process.env.TENANT_ID                 || '00000000-0000-0000-0000-000000000003';
const VAPI_SALON_2_ASSISTANT_ID = process.env.VAPI_SALON_2_ASSISTANT_ID || process.env.VAPI_SALON_ASSISTANT_ID_2 || '';

// ── Fixed UUIDs ───────────────────────────────────────────────────────────────
// cc-prefix = stylists (cf. aa-prefix for Morgenlicht) — c is valid hex
// ff-prefix = services (cf. bb-prefix for Morgenlicht) — f is valid hex
// db-prefix = bookings  (cf. dd-prefix for Morgenlicht)
// eb-prefix = booking_services (cf. ee-prefix for Morgenlicht)

const STYLIST_IDS = {
  lena:   'cc000001-0000-0000-0000-000000000001',
  oliver: 'cc000001-0000-0000-0000-000000000002',
};

const SERVICE_IDS = {
  damen_schnitt:      'ff000001-0000-0000-0000-000000000001',
  balayage:           'ff000001-0000-0000-0000-000000000002',
  glaettung:          'ff000001-0000-0000-0000-000000000003',
  herren_fade:        'ff000001-0000-0000-0000-000000000004',
  herren_classic:     'ff000001-0000-0000-0000-000000000005',
  bart_kontur:        'ff000001-0000-0000-0000-000000000006',
};

const DOW = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };

// ── Salon Settings ────────────────────────────────────────────────────────────
// Monday–Friday open — different from Morgenlicht (Tue–Sat)

const SALON_SETTINGS = {
  salon_name: 'Studio Nord',
  address: {
    street:      'Alsterchaussee 7',
    postal_code: '20149',
    city:        'Hamburg',
  },
  phone: '+49 40 555 12 400',
  email: 'info@studio-nord-hh.de',

  opening_hours: {
    monday:    { open: '08:00', close: '18:00' },
    tuesday:   { open: '08:00', close: '18:00' },
    wednesday: { open: '08:00', close: '20:00' },
    thursday:  { open: '08:00', close: '20:00' },
    friday:    { open: '08:00', close: '17:00' },
  },

  slot_duration_min:              30,
  buffer_after_minutes:           5,
  last_slot_before_close_minutes: 45,
  advance_book_days:              90,

  booking_rules: {
    cancellation_hours: 48,
    stylist_optional:   true,
    min_services:       1,
  },

  faq: {
    cancellation:     'Stornierungen sind bis zu 48 Stunden vor dem Termin kostenlos.',
    stylist_choice:   'Beide Stylisten sind für alle angebotenen Leistungen ausgebildet.',
    short_notice:     'Kurzfristige Termine direkt telefonisch anfragen.',
    appointment_info: 'Wir sind Montag bis Freitag geöffnet. Online-Buchung verfügbar.',
  },
};

// ── Stylists ──────────────────────────────────────────────────────────────────

const STYLISTS = [
  {
    id:        STYLIST_IDS.lena,
    name:      'Lena Fischer',
    specialty: 'Senior Stylistin — Balayage, Glättung, Damenschnitt',
  },
  {
    id:        STYLIST_IDS.oliver,
    name:      'Oliver Schmidt',
    specialty: 'Barber — Fade, Classic Cut, Bart-Konturenschnitt',
  },
];

// ── Services ──────────────────────────────────────────────────────────────────
// Distinct from Morgenlicht: different names, different prices.
// Key marker: Balayage (19900 ct) and Glättung are not in Morgenlicht.

const SERVICES = [
  // ── Damen ──
  {
    id:               SERVICE_IDS.damen_schnitt,
    category:         'Damen',
    name:             'Damen Schnitt & Style',
    description:      'Haarschnitt für Damen inkl. Waschen, Schneiden und Styling.',
    duration_minutes: 45,
    price_cents:      5500,
  },
  {
    id:               SERVICE_IDS.balayage,
    category:         'Damen',
    name:             'Balayage',
    description:      'Handcolorierung für natürliche Highlights — der Signature-Look von Studio Nord.',
    duration_minutes: 150,
    price_cents:      19900,
  },
  {
    id:               SERVICE_IDS.glaettung,
    category:         'Damen',
    name:             'Keratin-Glättung',
    description:      'Professionelle Keratin-Behandlung für glattes, geschmeidiges Haar.',
    duration_minutes: 120,
    price_cents:      16500,
  },
  // ── Herren ──
  {
    id:               SERVICE_IDS.herren_fade,
    category:         'Herren',
    name:             'Fade Cut',
    description:      'Moderner Fade-Schnitt mit Übergangsverlauf — Spezialität des Studios.',
    duration_minutes: 30,
    price_cents:      2900,
  },
  {
    id:               SERVICE_IDS.herren_classic,
    category:         'Herren',
    name:             'Classic Cut',
    description:      'Klassischer Herrenschnitt, zeitlos und gepflegt.',
    duration_minutes: 25,
    price_cents:      2400,
  },
  {
    id:               SERVICE_IDS.bart_kontur,
    category:         'Herren',
    name:             'Bart-Konturenschnitt',
    description:      'Präzise Bartpflege mit Konturschnitt und Abschlusspflege.',
    duration_minutes: 20,
    price_cents:      1600,
  },
];

// ── Stylist Working Hours ─────────────────────────────────────────────────────
// Studio Nord: Mon–Fri. No Saturday (different from Morgenlicht Tue–Sat).

const WORKING_HOURS = [
  // Lena Fischer — Mo–Fr
  { stylist_id: STYLIST_IDS.lena, day_of_week: DOW.mon, open: '08:00', close: '17:00' },
  { stylist_id: STYLIST_IDS.lena, day_of_week: DOW.tue, open: '08:00', close: '17:00' },
  { stylist_id: STYLIST_IDS.lena, day_of_week: DOW.wed, open: '08:00', close: '19:00' },
  { stylist_id: STYLIST_IDS.lena, day_of_week: DOW.thu, open: '08:00', close: '19:00' },
  { stylist_id: STYLIST_IDS.lena, day_of_week: DOW.fri, open: '08:00', close: '17:00' },
  // Oliver Schmidt — Di–Fr (kein Mo)
  { stylist_id: STYLIST_IDS.oliver, day_of_week: DOW.tue, open: '09:00', close: '18:00' },
  { stylist_id: STYLIST_IDS.oliver, day_of_week: DOW.wed, open: '09:00', close: '20:00' },
  { stylist_id: STYLIST_IDS.oliver, day_of_week: DOW.thu, open: '09:00', close: '20:00' },
  { stylist_id: STYLIST_IDS.oliver, day_of_week: DOW.fri, open: '09:00', close: '17:00' },
];

// ── Stylist–Service Capability Mapping ────────────────────────────────────────

const STYLIST_SERVICES = [
  // Lena Fischer
  { stylist_id: STYLIST_IDS.lena, service_id: SERVICE_IDS.damen_schnitt },
  { stylist_id: STYLIST_IDS.lena, service_id: SERVICE_IDS.balayage },
  { stylist_id: STYLIST_IDS.lena, service_id: SERVICE_IDS.glaettung },
  // Oliver Schmidt
  { stylist_id: STYLIST_IDS.oliver, service_id: SERVICE_IDS.herren_fade },
  { stylist_id: STYLIST_IDS.oliver, service_id: SERVICE_IDS.herren_classic },
  { stylist_id: STYLIST_IDS.oliver, service_id: SERVICE_IDS.bart_kontur },
];

// ── Demo Bookings (reference day: 2026-04-15, Wednesday) ─────────────────────
// Different reference day from Morgenlicht (2026-04-14) to avoid ambiguity.

const DEMO_BOOKINGS = [
  {
    id:                 'db000001-0000-0000-0000-000000000001',
    stylist_id:         STYLIST_IDS.lena,
    customer_name:      'Studio Demo Kundin 1',
    appointment_start:  '2026-04-15T09:00:00.000Z',
    appointment_end:    '2026-04-15T09:45:00.000Z',
    total_price_cents:  5500,
    total_duration_min: 45,
    notes:              'Demo-Buchung Studio Nord — Referenzdaten für Isolation-Tests',
    services: [
      {
        id:               'eb000001-0000-0000-0000-000000000001',
        service_id:       SERVICE_IDS.damen_schnitt,
        name_snapshot:    'Damen Schnitt & Style',
        duration_minutes: 45,
        price_cents:      5500,
      },
    ],
  },
  {
    id:                 'db000001-0000-0000-0000-000000000002',
    stylist_id:         STYLIST_IDS.oliver,
    customer_name:      'Studio Demo Kunde 2',
    appointment_start:  '2026-04-15T10:00:00.000Z',
    appointment_end:    '2026-04-15T10:30:00.000Z',
    total_price_cents:  2900,
    total_duration_min: 30,
    notes:              'Demo-Buchung Studio Nord — Referenzdaten für Isolation-Tests',
    services: [
      {
        id:               'eb000001-0000-0000-0000-000000000002',
        service_id:       SERVICE_IDS.herren_fade,
        name_snapshot:    'Fade Cut',
        duration_minutes: 30,
        price_cents:      2900,
      },
    ],
  },
  {
    id:                 'db000001-0000-0000-0000-000000000003',
    stylist_id:         STYLIST_IDS.lena,
    customer_name:      'Studio Demo Kundin 3',
    appointment_start:  '2026-04-15T13:00:00.000Z',
    appointment_end:    '2026-04-15T15:30:00.000Z',
    total_price_cents:  19900,
    total_duration_min: 150,
    notes:              'Demo-Buchung Studio Nord — Referenzdaten für Isolation-Tests',
    services: [
      {
        id:               'eb000001-0000-0000-0000-000000000003',
        service_id:       SERVICE_IDS.balayage,
        name_snapshot:    'Balayage',
        duration_minutes: 150,
        price_cents:      19900,
      },
    ],
  },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

async function setTenant(client) {
  await client.query(`SET app.current_tenant = '${TENANT_ID}'`);
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await setTenant(client);

    console.log(`\nSeeding Studio Nord — Tenant: ${TENANT_ID}`);
    console.log('─'.repeat(60));

    // ── 1. Salon Settings ───────────────────────────────────────────────────

    await client.query(
      `INSERT INTO salon_settings (tenant_id, settings)
       VALUES ($1, $2)
       ON CONFLICT (tenant_id) DO UPDATE SET settings = EXCLUDED.settings, updated_at = now()`,
      [TENANT_ID, JSON.stringify(SALON_SETTINGS)],
    );
    console.log('  ✓ salon_settings — Studio Nord, Hamburg');

    // ── 2. Stylists ─────────────────────────────────────────────────────────

    for (const s of STYLISTS) {
      await client.query(
        `INSERT INTO salon_stylists (id, tenant_id, name, specialty, is_active)
         VALUES ($1, $2, $3, $4, true)
         ON CONFLICT (id) DO UPDATE
           SET name = EXCLUDED.name,
               specialty = EXCLUDED.specialty,
               updated_at = now()`,
        [s.id, TENANT_ID, s.name, s.specialty],
      );
      console.log(`  ✓ Stylist: ${s.name}`);
    }

    // ── 3. Services ─────────────────────────────────────────────────────────

    for (const svc of SERVICES) {
      await client.query(
        `INSERT INTO salon_services
           (id, tenant_id, category, name, description, duration_minutes, price_cents, is_active)
         VALUES ($1, $2, $3, $4, $5, $6, $7, true)
         ON CONFLICT (id) DO UPDATE
           SET category         = EXCLUDED.category,
               name             = EXCLUDED.name,
               description      = EXCLUDED.description,
               duration_minutes = EXCLUDED.duration_minutes,
               price_cents      = EXCLUDED.price_cents,
               updated_at       = now()`,
        [svc.id, TENANT_ID, svc.category, svc.name, svc.description, svc.duration_minutes, svc.price_cents],
      );
      console.log(`  ✓ Service: ${svc.category} / ${svc.name} (${svc.duration_minutes} min, ${(svc.price_cents / 100).toFixed(2)} €)`);
    }

    // ── 4. Stylist Working Hours ─────────────────────────────────────────────

    for (const wh of WORKING_HOURS) {
      await client.query(
        `INSERT INTO salon_stylist_working_hours
           (tenant_id, stylist_id, day_of_week, open_time, close_time, is_active)
         VALUES ($1, $2, $3, $4, $5, true)
         ON CONFLICT (tenant_id, stylist_id, day_of_week) DO UPDATE
           SET open_time  = EXCLUDED.open_time,
               close_time = EXCLUDED.close_time,
               is_active  = true,
               updated_at = now()`,
        [TENANT_ID, wh.stylist_id, wh.day_of_week, wh.open, wh.close],
      );
    }
    console.log(`  ✓ Working hours — ${WORKING_HOURS.length} entries (${STYLISTS.length} stylists)`);

    // ── 5. Stylist–Service Mapping ───────────────────────────────────────────

    for (const ss of STYLIST_SERVICES) {
      await client.query(
        `INSERT INTO salon_stylist_services (tenant_id, stylist_id, service_id)
         VALUES ($1, $2, $3)
         ON CONFLICT (tenant_id, stylist_id, service_id) DO NOTHING`,
        [TENANT_ID, ss.stylist_id, ss.service_id],
      );
    }
    console.log(`  ✓ Stylist-service mapping — ${STYLIST_SERVICES.length} entries`);

    // ── 6. Demo Bookings (2026-04-15, Wednesday) ─────────────────────────────

    for (const booking of DEMO_BOOKINGS) {
      await client.query(
        `INSERT INTO salon_bookings (
           id, tenant_id, status, source,
           customer_name, stylist_id,
           appointment_start, appointment_end,
           total_price_cents, total_duration_min,
           notes, confirmed_at
         )
         VALUES ($1, $2, 'confirmed', 'voice', $3, $4, $5, $6, $7, $8, $9, '2026-04-14T10:00:00.000Z')
         ON CONFLICT (id) DO UPDATE
           SET stylist_id         = EXCLUDED.stylist_id,
               customer_name      = EXCLUDED.customer_name,
               appointment_start  = EXCLUDED.appointment_start,
               appointment_end    = EXCLUDED.appointment_end,
               total_price_cents  = EXCLUDED.total_price_cents,
               total_duration_min = EXCLUDED.total_duration_min,
               status             = 'confirmed',
               updated_at         = now()`,
        [
          booking.id, TENANT_ID, booking.customer_name, booking.stylist_id,
          booking.appointment_start, booking.appointment_end,
          booking.total_price_cents, booking.total_duration_min, booking.notes,
        ],
      );

      for (const svc of booking.services) {
        await client.query(
          `INSERT INTO salon_booking_services
             (id, tenant_id, booking_id, service_id, name_snapshot, duration_minutes, price_cents)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           ON CONFLICT (id) DO UPDATE
             SET service_id       = EXCLUDED.service_id,
                 name_snapshot    = EXCLUDED.name_snapshot,
                 duration_minutes = EXCLUDED.duration_minutes,
                 price_cents      = EXCLUDED.price_cents`,
          [svc.id, TENANT_ID, booking.id, svc.service_id, svc.name_snapshot, svc.duration_minutes, svc.price_cents],
        );
      }

      const stylist  = STYLISTS.find((s) => s.id === booking.stylist_id);
      const start    = booking.appointment_start.slice(11, 16);
      const end      = booking.appointment_end.slice(11, 16);
      console.log(`  ✓ Demo booking: ${stylist?.name ?? booking.stylist_id} ${start}–${end} — ${booking.services[0].name_snapshot}`);
    }

    // ── 7. Voice Agent (salon track) ─────────────────────────────────────────

    if (!VAPI_SALON_2_ASSISTANT_ID) {
      console.log('  ⚠ VAPI_SALON_2_ASSISTANT_ID not set — skipping voice_agents insert');
    } else {
      const providerRes = await client.query(
        `SELECT id FROM voice_providers WHERE tenant_id = $1 AND status = 'active' LIMIT 1`,
        [TENANT_ID],
      );

      if (providerRes.rows.length === 0) {
        // Try to find a provider from any tenant and create one for Studio Nord
        // Check if there's a template provider we can copy settings from
        console.log('  ⚠ No active voice_providers found for tenant.');
        console.log('    Attempting to create a voice_providers row for Studio Nord...');

        // Get the provider type from an existing tenant
        const existingProvider = await client.query(
          `SELECT provider_type, name, config_ref, webhook_signing_mode
           FROM voice_providers WHERE status = 'active' LIMIT 1`,
        );

        if (existingProvider.rows.length > 0) {
          const ep = existingProvider.rows[0];
          const newProviderRes = await client.query(
            `INSERT INTO voice_providers (tenant_id, provider_type, name, status, config_ref, webhook_signing_mode)
             VALUES ($1, $2, 'Studio Nord Voice Provider', 'active', $3, $4)
             RETURNING id`,
            [TENANT_ID, ep.provider_type, ep.config_ref, ep.webhook_signing_mode],
          );
          const providerId = newProviderRes.rows[0].id;

          const agentRes = await client.query(
            `INSERT INTO voice_agents
               (tenant_id, voice_provider_id, provider_agent_id, name, status, track_scope)
             VALUES ($1, $2, $3, 'Studio Nord Voice Agent', 'active', 'salon')
             ON CONFLICT (tenant_id, voice_provider_id, provider_agent_id) DO UPDATE
               SET name       = EXCLUDED.name,
                   status     = 'active',
                   track_scope = 'salon',
                   updated_at  = now()
             RETURNING id`,
            [TENANT_ID, providerId, VAPI_SALON_2_ASSISTANT_ID],
          );
          console.log(`  ✓ Voice provider created for Studio Nord`);
          console.log(`  ✓ Voice agent: ${agentRes.rows[0].id} (track: salon, provider_agent_id: ${VAPI_SALON_2_ASSISTANT_ID})`);
        } else {
          console.log('  ⚠ No voice_providers found at all — skipping voice agent');
        }
      } else {
        const providerId = providerRes.rows[0].id;
        const agentRes = await client.query(
          `INSERT INTO voice_agents
             (tenant_id, voice_provider_id, provider_agent_id, name, status, track_scope)
           VALUES ($1, $2, $3, 'Studio Nord Voice Agent', 'active', 'salon')
           ON CONFLICT (tenant_id, voice_provider_id, provider_agent_id) DO UPDATE
             SET name       = EXCLUDED.name,
                 status     = 'active',
                 track_scope = 'salon',
                 updated_at  = now()
           RETURNING id`,
          [TENANT_ID, providerId, VAPI_SALON_2_ASSISTANT_ID],
        );
        console.log(`  ✓ Voice agent: ${agentRes.rows[0].id} (track: salon, provider_agent_id: ${VAPI_SALON_2_ASSISTANT_ID})`);
      }
    }

    await client.query('COMMIT');

    // ── Feature provisioning (outside transaction — idempotent, safe to retry) ──
    console.log('\nProvisioning features (voice + salon domains)…');
    await provisionTenantDomains(client, TENANT_ID, ['voice', 'salon']);

    console.log('─'.repeat(60));
    console.log('✅ Studio Nord seeding complete.\n');
    console.log('Summary:');
    console.log(`  Tenant:   ${TENANT_ID}`);
    console.log(`  Services: ${SERVICES.length} (Damen: 3, Herren: 3)`);
    console.log(`  Stylists: ${STYLISTS.length} (Lena Fischer, Oliver Schmidt)`);
    console.log(`  Working hours: ${WORKING_HOURS.length} weekly schedule entries`);
    console.log(`  Stylist-service links: ${STYLIST_SERVICES.length}`);
    console.log(`  Demo bookings: ${DEMO_BOOKINGS.length} (reference day: 2026-04-15)`);

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('\n❌ Seeding failed:', err.message);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
