/**
 * seed-salon-tenant.js
 *
 * Seeds Tenant 2 — Salon Morgenlicht, Köln.
 * Full demo dataset: services, stylists, settings, working hours,
 * stylist-service mapping, demo bookings, voice agent.
 *
 * Idempotent: uses fixed UUIDs + ON CONFLICT … DO UPDATE throughout.
 * Safe to re-run on an existing tenant without duplicating data.
 *
 * Prerequisites:
 *   - Migrations 20260408000003, 20260408000004, 20260408000005 applied
 *   - DATABASE_URL set in environment or .env
 *   - A voice_providers row must exist for TENANT_ID (or voice agent step is skipped)
 *
 * Usage:
 *   DATABASE_URL=... \
 *   TENANT_ID=<uuid> \
 *   VAPI_SALON_ASSISTANT_ID=<vapi-assistant-id> \
 *   node backend/seed-salon-tenant.js
 *
 * Defaults:
 *   TENANT_ID              = 00000000-0000-0000-0000-000000000002
 *   VAPI_SALON_ASSISTANT_ID = '' (voice agent step skipped when empty)
 */

'use strict';

require('dotenv').config();
const { Pool } = require('pg');
const { provisionTenantDomains } = require('./lib/provision-tenant-domains');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// ── Config ────────────────────────────────────────────────────────────────────

const TENANT_ID               = process.env.TENANT_ID               || '00000000-0000-0000-0000-000000000002';
const VAPI_SALON_ASSISTANT_ID = process.env.VAPI_SALON_ASSISTANT_ID || '';

// ── Fixed UUIDs ───────────────────────────────────────────────────────────────
// Deterministic IDs make ON CONFLICT (id) DO UPDATE safe to re-run at any time.
// Pattern: aa000001-… = stylists, bb000001-… = services, dd000001-… = bookings.

const STYLIST_IDS = {
  anna:   'aa000001-0000-0000-0000-000000000001',
  mehmet: 'aa000001-0000-0000-0000-000000000002',
  sofia:  'aa000001-0000-0000-0000-000000000003',
};

const SERVICE_IDS = {
  damenhaarschnitt:  'bb000001-0000-0000-0000-000000000001',
  waschen_schneiden: 'bb000001-0000-0000-0000-000000000002',
  ansatzfarbe:       'bb000001-0000-0000-0000-000000000003',
  komplettfarbe:     'bb000001-0000-0000-0000-000000000004',
  herrenhaarschnitt: 'bb000001-0000-0000-0000-000000000005',
  maschinenschnitt:  'bb000001-0000-0000-0000-000000000006',
  bart_trimmen:      'bb000001-0000-0000-0000-000000000007',
  herren_bart:       'bb000001-0000-0000-0000-000000000008',
  intensivpflege:    'bb000001-0000-0000-0000-000000000009',
  styling:           'bb000001-0000-0000-0000-00000000000a',
};

// day_of_week: 0=Sunday, 1=Monday, 2=Tuesday, 3=Wednesday, 4=Thursday, 5=Friday, 6=Saturday
const DOW = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };

// ── Salon Settings ────────────────────────────────────────────────────────────
// Monday and Sunday are absent → treated as closed by the knowledge resolver.

const SALON_SETTINGS = {
  salon_name: 'Salon Morgenlicht',
  address: {
    street:      'Lindenstraße 14',
    postal_code: '50674',
    city:        'Köln',
  },
  phone: '+49 221 555 88 210',
  email: 'kontakt@salon-morgenlicht.de',

  // Keys must be lowercase English weekday names (used by salon-knowledge-resolver).
  // Absent key = closed that day.
  opening_hours: {
    tuesday:   { open: '09:00', close: '18:00' },
    wednesday: { open: '09:00', close: '18:00' },
    thursday:  { open: '10:00', close: '20:00' },
    friday:    { open: '09:00', close: '19:00' },
    saturday:  { open: '09:00', close: '14:00' },
  },

  // Booking rules
  slot_duration_min:              30,  // read by getSalonSettings()
  buffer_after_minutes:           10,  // Phase 2: gap between appointments
  last_slot_before_close_minutes: 60,  // Phase 2: no new starts within 60 min of close
  advance_book_days:              60,  // how far ahead bookings are allowed

  booking_rules: {
    cancellation_hours: 24,
    stylist_optional:   true,
    min_services:       1,
  },

  // FAQ answers surfaced by the knowledge resolver (intent key → answer)
  faq: {
    cancellation:     'Stornierungen sind bis zu 24 Stunden vor dem Termin kostenlos möglich.',
    stylist_choice:   'Sie können bei der Buchung einen Wunsch-Stylisten angeben. Wir berücksichtigen Ihre Wahl, soweit möglich.',
    short_notice:     'Kurzfristige Termine sind je nach Verfügbarkeit möglich. Fragen Sie uns gerne direkt.',
    appointment_info: 'Termine können Sie telefonisch oder über unseren Sprachassistenten vereinbaren.',
  },
};

// ── Stylists ──────────────────────────────────────────────────────────────────

const STYLISTS = [
  {
    id:        STYLIST_IDS.anna,
    name:      'Anna Weber',
    specialty: 'Senior Stylistin — Damenhaarschnitt, Coloration, Styling',
  },
  {
    id:        STYLIST_IDS.mehmet,
    name:      'Mehmet Kaya',
    specialty: 'Barber / Stylist — Herrenhaarschnitt, Bart, Maschinenhaarschnitt',
  },
  {
    id:        STYLIST_IDS.sofia,
    name:      'Sofia Becker',
    specialty: 'Stylistin — Waschen, Schneiden, Föhnen, Intensivpflege',
  },
];

// ── Services ──────────────────────────────────────────────────────────────────

const SERVICES = [
  // ── Damen ──
  {
    id:               SERVICE_IDS.damenhaarschnitt,
    category:         'Damen',
    name:             'Damenhaarschnitt',
    description:      'Professioneller Damenhaarschnitt inkl. Waschen und Föhnen nach Wunsch.',
    duration_minutes: 60,
    price_cents:      6800,
  },
  {
    id:               SERVICE_IDS.waschen_schneiden,
    category:         'Damen',
    name:             'Waschen + Schneiden + Föhnen',
    description:      'Haarwäsche mit Pflegespülung, Schnitt und professionellem Föhnen.',
    duration_minutes: 75,
    price_cents:      8900,
  },
  {
    id:               SERVICE_IDS.ansatzfarbe,
    category:         'Damen',
    name:             'Ansatzfarbe',
    description:      'Ansatzbehandlung zum Auffrischen der Haarfarbe an den Wurzeln.',
    duration_minutes: 90,
    price_cents:      9500,
  },
  {
    id:               SERVICE_IDS.komplettfarbe,
    category:         'Damen',
    name:             'Komplettfarbe',
    description:      'Vollständige Haarfärbung von Ansatz bis Spitzen inkl. Einwirkzeit und Auswaschen.',
    duration_minutes: 120,
    price_cents:      14500,
  },
  // ── Herren ──
  {
    id:               SERVICE_IDS.herrenhaarschnitt,
    category:         'Herren',
    name:             'Herrenhaarschnitt',
    description:      'Klassischer Herrenhaarschnitt inkl. Waschen und Stylen.',
    duration_minutes: 30,
    price_cents:      3400,
  },
  {
    id:               SERVICE_IDS.maschinenschnitt,
    category:         'Herren',
    name:             'Maschinenhaarschnitt',
    description:      'Schneller Maschinenhaarschnitt mit verschiedenen Aufsätzen nach Wunsch.',
    duration_minutes: 20,
    price_cents:      2400,
  },
  {
    id:               SERVICE_IDS.bart_trimmen,
    category:         'Herren',
    name:             'Bart trimmen',
    description:      'Bartpflege mit Konturenschnitt und Formgebung.',
    duration_minutes: 20,
    price_cents:      1800,
  },
  {
    id:               SERVICE_IDS.herren_bart,
    category:         'Herren',
    name:             'Herrenhaarschnitt + Bart',
    description:      'Kombination aus Herrenhaarschnitt und Bartpflege — zum Vorzugspreis.',
    duration_minutes: 45,
    price_cents:      4600,
  },
  // ── Pflege / Styling ──
  {
    id:               SERVICE_IDS.intensivpflege,
    category:         'Pflege / Styling',
    name:             'Intensivpflege',
    description:      'Tiefenwirksame Pflegebehandlung für strapaziertes oder trockenes Haar.',
    duration_minutes: 20,
    price_cents:      1900,
  },
  {
    id:               SERVICE_IDS.styling,
    category:         'Pflege / Styling',
    name:             'Styling',
    description:      'Professionelles Styling und Föhnen nach Wunsch — für jeden Anlass.',
    duration_minutes: 30,
    price_cents:      2900,
  },
];

// ── Stylist Working Hours ─────────────────────────────────────────────────────
// day_of_week: 0=Sun 1=Mon 2=Tue 3=Wed 4=Thu 5=Fri 6=Sat

const WORKING_HOURS = [
  // Anna Weber — Di–Sa, frei Mo+So
  { stylist_id: STYLIST_IDS.anna, day_of_week: DOW.tue, open: '09:00', close: '17:00' },
  { stylist_id: STYLIST_IDS.anna, day_of_week: DOW.wed, open: '09:00', close: '17:00' },
  { stylist_id: STYLIST_IDS.anna, day_of_week: DOW.thu, open: '12:00', close: '20:00' },
  { stylist_id: STYLIST_IDS.anna, day_of_week: DOW.fri, open: '09:00', close: '18:00' },
  { stylist_id: STYLIST_IDS.anna, day_of_week: DOW.sat, open: '09:00', close: '14:00' },
  // Mehmet Kaya — Di–Sa, frei Mo+So
  { stylist_id: STYLIST_IDS.mehmet, day_of_week: DOW.tue, open: '10:00', close: '18:00' },
  { stylist_id: STYLIST_IDS.mehmet, day_of_week: DOW.wed, open: '10:00', close: '18:00' },
  { stylist_id: STYLIST_IDS.mehmet, day_of_week: DOW.thu, open: '10:00', close: '20:00' },
  { stylist_id: STYLIST_IDS.mehmet, day_of_week: DOW.fri, open: '10:00', close: '19:00' },
  { stylist_id: STYLIST_IDS.mehmet, day_of_week: DOW.sat, open: '09:00', close: '14:00' },
  // Sofia Becker — Di, Mi, Fr, Sa (kein Do)
  { stylist_id: STYLIST_IDS.sofia, day_of_week: DOW.tue, open: '09:00', close: '15:00' },
  { stylist_id: STYLIST_IDS.sofia, day_of_week: DOW.wed, open: '09:00', close: '15:00' },
  { stylist_id: STYLIST_IDS.sofia, day_of_week: DOW.fri, open: '09:00', close: '15:00' },
  { stylist_id: STYLIST_IDS.sofia, day_of_week: DOW.sat, open: '09:00', close: '14:00' },
];

// ── Stylist–Service Capability Mapping ────────────────────────────────────────

const STYLIST_SERVICES = [
  // Anna Weber
  { stylist_id: STYLIST_IDS.anna, service_id: SERVICE_IDS.damenhaarschnitt },
  { stylist_id: STYLIST_IDS.anna, service_id: SERVICE_IDS.waschen_schneiden },
  { stylist_id: STYLIST_IDS.anna, service_id: SERVICE_IDS.ansatzfarbe },
  { stylist_id: STYLIST_IDS.anna, service_id: SERVICE_IDS.komplettfarbe },
  { stylist_id: STYLIST_IDS.anna, service_id: SERVICE_IDS.styling },
  // Mehmet Kaya
  { stylist_id: STYLIST_IDS.mehmet, service_id: SERVICE_IDS.herrenhaarschnitt },
  { stylist_id: STYLIST_IDS.mehmet, service_id: SERVICE_IDS.maschinenschnitt },
  { stylist_id: STYLIST_IDS.mehmet, service_id: SERVICE_IDS.bart_trimmen },
  { stylist_id: STYLIST_IDS.mehmet, service_id: SERVICE_IDS.herren_bart },
  // Sofia Becker
  { stylist_id: STYLIST_IDS.sofia, service_id: SERVICE_IDS.damenhaarschnitt },
  { stylist_id: STYLIST_IDS.sofia, service_id: SERVICE_IDS.waschen_schneiden },
  { stylist_id: STYLIST_IDS.sofia, service_id: SERVICE_IDS.intensivpflege },
  { stylist_id: STYLIST_IDS.sofia, service_id: SERVICE_IDS.styling },
];

// ── Demo Bookings (reference day: 2026-04-14, Tuesday) ───────────────────────
// Confirmed bookings to populate the calendar for availability testing.
// Times stored as UTC (timezone-aware storage is Phase 2).
//
// Anna Weber:   10:00–11:00 Damenhaarschnitt, 14:00–15:30 Ansatzfarbe
// Mehmet Kaya:  11:00–11:30 Herrenhaarschnitt, 16:00–16:45 Herrenhaarschnitt + Bart
// Sofia Becker: 09:30–10:45 Waschen + Schneiden + Föhnen

const DEMO_BOOKINGS = [
  {
    id:                 'dd000001-0000-0000-0000-000000000001',
    stylist_id:         STYLIST_IDS.anna,
    customer_name:      'Demo Kundin A',
    appointment_start:  '2026-04-14T10:00:00.000Z',
    appointment_end:    '2026-04-14T11:00:00.000Z',
    total_price_cents:  6800,
    total_duration_min: 60,
    notes:              'Demo-Buchung — Referenzdaten für Availability-Tests',
    services: [
      {
        id:               'ee000001-0000-0000-0000-000000000001',
        service_id:       SERVICE_IDS.damenhaarschnitt,
        name_snapshot:    'Damenhaarschnitt',
        duration_minutes: 60,
        price_cents:      6800,
      },
    ],
  },
  {
    id:                 'dd000001-0000-0000-0000-000000000002',
    stylist_id:         STYLIST_IDS.anna,
    customer_name:      'Demo Kundin B',
    appointment_start:  '2026-04-14T14:00:00.000Z',
    appointment_end:    '2026-04-14T15:30:00.000Z',
    total_price_cents:  9500,
    total_duration_min: 90,
    notes:              'Demo-Buchung — Referenzdaten für Availability-Tests',
    services: [
      {
        id:               'ee000001-0000-0000-0000-000000000002',
        service_id:       SERVICE_IDS.ansatzfarbe,
        name_snapshot:    'Ansatzfarbe',
        duration_minutes: 90,
        price_cents:      9500,
      },
    ],
  },
  {
    id:                 'dd000001-0000-0000-0000-000000000003',
    stylist_id:         STYLIST_IDS.mehmet,
    customer_name:      'Demo Kunde C',
    appointment_start:  '2026-04-14T11:00:00.000Z',
    appointment_end:    '2026-04-14T11:30:00.000Z',
    total_price_cents:  3400,
    total_duration_min: 30,
    notes:              'Demo-Buchung — Referenzdaten für Availability-Tests',
    services: [
      {
        id:               'ee000001-0000-0000-0000-000000000003',
        service_id:       SERVICE_IDS.herrenhaarschnitt,
        name_snapshot:    'Herrenhaarschnitt',
        duration_minutes: 30,
        price_cents:      3400,
      },
    ],
  },
  {
    id:                 'dd000001-0000-0000-0000-000000000004',
    stylist_id:         STYLIST_IDS.mehmet,
    customer_name:      'Demo Kunde D',
    appointment_start:  '2026-04-14T16:00:00.000Z',
    appointment_end:    '2026-04-14T16:45:00.000Z',
    total_price_cents:  4600,
    total_duration_min: 45,
    notes:              'Demo-Buchung — Referenzdaten für Availability-Tests',
    services: [
      {
        id:               'ee000001-0000-0000-0000-000000000004',
        service_id:       SERVICE_IDS.herren_bart,
        name_snapshot:    'Herrenhaarschnitt + Bart',
        duration_minutes: 45,
        price_cents:      4600,
      },
    ],
  },
  {
    id:                 'dd000001-0000-0000-0000-000000000005',
    stylist_id:         STYLIST_IDS.sofia,
    customer_name:      'Demo Kundin E',
    appointment_start:  '2026-04-14T09:30:00.000Z',
    appointment_end:    '2026-04-14T10:45:00.000Z',
    total_price_cents:  8900,
    total_duration_min: 75,
    notes:              'Demo-Buchung — Referenzdaten für Availability-Tests',
    services: [
      {
        id:               'ee000001-0000-0000-0000-000000000005',
        service_id:       SERVICE_IDS.waschen_schneiden,
        name_snapshot:    'Waschen + Schneiden + Föhnen',
        duration_minutes: 75,
        price_cents:      8900,
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

    console.log(`\nSeeding Salon Morgenlicht — Tenant: ${TENANT_ID}`);
    console.log('─'.repeat(60));

    // ── 1. Salon Settings ───────────────────────────────────────────────────

    await client.query(
      `INSERT INTO salon_settings (tenant_id, settings)
       VALUES ($1, $2)
       ON CONFLICT (tenant_id) DO UPDATE SET settings = EXCLUDED.settings, updated_at = now()`,
      [TENANT_ID, JSON.stringify(SALON_SETTINGS)],
    );
    console.log('  ✓ salon_settings — Salon Morgenlicht, Köln');

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

    const DAY_NAMES = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
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

    // ── 6. Demo Bookings (2026-04-14, Tuesday) ───────────────────────────────

    for (const booking of DEMO_BOOKINGS) {
      // Upsert booking row — confirmed_at = day before demo day
      await client.query(
        `INSERT INTO salon_bookings (
           id, tenant_id, status, source,
           customer_name, stylist_id,
           appointment_start, appointment_end,
           total_price_cents, total_duration_min,
           notes, confirmed_at
         )
         VALUES ($1, $2, 'confirmed', 'voice', $3, $4, $5, $6, $7, $8, $9, '2026-04-13T10:00:00.000Z')
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

      // Upsert booking services
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

      // Find stylist name for log
      const stylist = STYLISTS.find((s) => s.id === booking.stylist_id);
      const startTime = booking.appointment_start.slice(11, 16);
      const endTime   = booking.appointment_end.slice(11, 16);
      console.log(`  ✓ Demo booking: ${stylist?.name ?? booking.stylist_id} ${startTime}–${endTime} — ${booking.services[0].name_snapshot}`);
    }

    // ── 7. Voice Agent (salon track) ─────────────────────────────────────────

    if (!VAPI_SALON_ASSISTANT_ID) {
      console.log('  ⚠ VAPI_SALON_ASSISTANT_ID not set — skipping voice_agents insert');
      console.log('    Set it and re-run to register the voice agent.');
    } else {
      const providerRes = await client.query(
        `SELECT id FROM voice_providers WHERE tenant_id = $1 AND status = 'active' LIMIT 1`,
        [TENANT_ID],
      );

      if (providerRes.rows.length === 0) {
        console.log('  ⚠ No active voice_providers found for tenant — skipping voice_agents insert');
        console.log('    Create a voice_providers row first, then re-run this script.');
      } else {
        const providerId = providerRes.rows[0].id;
        const agentRes = await client.query(
          `INSERT INTO voice_agents
             (tenant_id, voice_provider_id, provider_agent_id, name, status, track_scope)
           VALUES ($1, $2, $3, 'Salon Morgenlicht Voice Agent', 'active', 'salon')
           ON CONFLICT (tenant_id, voice_provider_id, provider_agent_id) DO UPDATE
             SET name       = EXCLUDED.name,
                 status     = 'active',
                 track_scope = 'salon',
                 updated_at  = now()
           RETURNING id`,
          [TENANT_ID, providerId, VAPI_SALON_ASSISTANT_ID],
        );
        console.log(`  ✓ Voice agent: ${agentRes.rows[0].id} (track: salon, provider_agent_id: ${VAPI_SALON_ASSISTANT_ID})`);
      }
    }

    await client.query('COMMIT');

    // ── Feature provisioning (outside transaction — idempotent, safe to retry) ──
    console.log('\nProvisioning features (voice + salon domains)…');
    await provisionTenantDomains(client, TENANT_ID, ['voice', 'salon']);

    console.log('─'.repeat(60));
    console.log('✅ Salon Morgenlicht seeding complete.\n');
    console.log('Summary:');
    console.log(`  Tenant:   ${TENANT_ID}`);
    console.log(`  Services: ${SERVICES.length} (Damen: 4, Herren: 4, Pflege/Styling: 2)`);
    console.log(`  Stylists: ${STYLISTS.length} (Anna Weber, Mehmet Kaya, Sofia Becker)`);
    console.log(`  Working hours: ${WORKING_HOURS.length} weekly schedule entries`);
    console.log(`  Stylist-service links: ${STYLIST_SERVICES.length}`);
    console.log(`  Demo bookings: ${DEMO_BOOKINGS.length} (reference day: 2026-04-14)`);

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
