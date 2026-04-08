// src/modules/voice/tools/salon/salon-knowledge-resolver.ts
//
// Deterministic knowledge layer for salon FAQ questions.
// Analogous to restaurant/knowledge-resolver.ts.

import { getSalonSettings }    from '../../repositories/salon-settings.repository.js';
import { getStylistsByTenant } from '../../repositories/salon-stylists.repository.js';
import { getServicesByTenant } from '../../repositories/salon-services.repository.js';

// ── Types ─────────────────────────────────────────────────────────────────────

export type SalonKnowledgeIntent =
  | 'opening_hours'
  | 'services_list'
  | 'service_duration'
  | 'service_price'
  | 'stylist_availability'
  | 'today_appointment'
  | 'unknown';

export interface SalonKnowledgeResult {
  handled:   boolean;
  intent:    SalonKnowledgeIntent;
  answer?:   string;
  metadata?: Record<string, unknown>;
}

// ── Intent detection ──────────────────────────────────────────────────────────

const INTENT_PATTERNS: Array<{ intent: SalonKnowledgeIntent; patterns: RegExp[] }> = [
  {
    intent: 'opening_hours',
    patterns: [
      /\b(ge[öo]ffnet|[öo]ffnungszeit|[öo]ffnungszeiten|[öo]ffnen|aufhaben|aufgemacht)\b/i,
      /\b(wann (habt|seid|sind) ihr)\b/i,
      /\b(bis wann)\b/i,
      /\b(heute (noch )?offen)\b/i,
    ],
  },
  {
    intent: 'services_list',
    patterns: [
      /\b(welche (leistungen?|dienste?|angebote?|services?))\b/i,
      /\b(was (macht|bietet|anbietet) ihr)\b/i,
      /\b(was (gibt|habt|haben) ihr)\b/i,
      /\b(euer angebot|euer(e)? leistungen?)\b/i,
    ],
  },
  {
    intent: 'service_duration',
    patterns: [
      /\b(wie lange (dauert?|braucht?))\b/i,
      /\b(dauer|zeitdauer|zeitaufwand)\b/i,
      /\b(wie viel\s*zeit)\b/i,
    ],
  },
  {
    intent: 'service_price',
    patterns: [
      /\b(was kostet?|wie viel kostet?|preis|preise|was zahle)\b/i,
      /\b(kosten|gebühr|tarif)\b/i,
    ],
  },
  {
    intent: 'stylist_availability',
    patterns: [
      /\b(arbeitet?|ist\s+\w+\s+(da|verfügbar|heute))\b/i,
      /\b(kann ich (zu|bei|mit)\s+\w+)\b/i,
      /\b(stylist|friseur|friseurin|mitarbeiter)\b/i,
    ],
  },
  {
    intent: 'today_appointment',
    patterns: [
      /\b(heute noch (einen? termin?|verfügbar|frei))\b/i,
      /\b(noch termin(e)? heute)\b/i,
      /\b(kurzfristig|spontan)\b/i,
    ],
  },
];

export function detectSalonIntent(question: string): SalonKnowledgeIntent {
  const q = question.toLowerCase();
  for (const { intent, patterns } of INTENT_PATTERNS) {
    if (patterns.some((p) => p.test(q))) return intent;
  }
  return 'unknown';
}

// ── Formatting helpers ────────────────────────────────────────────────────────

function centToEuro(cents: number): string {
  return (cents / 100).toFixed(2).replace('.', ',') + ' €';
}

function formatTime(t: string): string {
  return t + ' Uhr';
}

// ── Opening hours helpers ─────────────────────────────────────────────────────

const WEEKDAY_NAMES_EN: Record<number, string> = {
  0: 'sunday', 1: 'monday', 2: 'tuesday', 3: 'wednesday',
  4: 'thursday', 5: 'friday', 6: 'saturday',
};

const WEEKDAY_DE: Record<string, string> = {
  monday: 'Montag', tuesday: 'Dienstag', wednesday: 'Mittwoch',
  thursday: 'Donnerstag', friday: 'Freitag', saturday: 'Samstag', sunday: 'Sonntag',
};

interface BerlinTime {
  weekday: string;
  hour:    number;
  minute:  number;
}

function getBerlinTime(): BerlinTime {
  const now   = new Date();
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Berlin',
    weekday:  'long',
    hour:     '2-digit',
    minute:   '2-digit',
    hour12:   false,
  }).formatToParts(now);

  const weekday = (parts.find((p) => p.type === 'weekday')?.value ?? 'Monday').toLowerCase();
  const hour    = parseInt(parts.find((p) => p.type === 'hour')?.value ?? '0', 10);
  const minute  = parseInt(parts.find((p) => p.type === 'minute')?.value ?? '0', 10);
  return { weekday, hour, minute };
}

function buildOpeningHoursString(
  hours: Record<string, { open: string; close: string }>,
): string {
  const days   = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
  const groups: Array<{ days: string[]; open: string; close: string }> = [];

  for (const day of days) {
    const entry = hours[day];
    if (!entry) continue;
    const last = groups[groups.length - 1];
    if (last && last.open === entry.open && last.close === entry.close) {
      last.days.push(day);
    } else {
      groups.push({ days: [day], open: entry.open, close: entry.close });
    }
  }

  return groups
    .map((g) => {
      const label =
        g.days.length === 1
          ? WEEKDAY_DE[g.days[0]]
          : `${WEEKDAY_DE[g.days[0]]}–${WEEKDAY_DE[g.days[g.days.length - 1]]}`;
      return `${label} ${formatTime(g.open)}–${formatTime(g.close)}`;
    })
    .join(', ');
}

function isCurrentlyOpen(
  hours: Record<string, { open: string; close: string }>,
  berlin: BerlinTime,
): boolean {
  const today = hours[berlin.weekday];
  if (!today) return false;
  const [openH, openM]   = today.open.split(':').map(Number);
  const [closeH, closeM] = today.close.split(':').map(Number);
  const nowMins          = berlin.hour * 60 + berlin.minute;
  return nowMins >= openH * 60 + openM && nowMins < closeH * 60 + closeM;
}

// ── Resolvers ─────────────────────────────────────────────────────────────────

async function resolveOpeningHours(tenantId: string): Promise<SalonKnowledgeResult> {
  const settings = await getSalonSettings(tenantId);
  const hours    = settings.opening_hours;

  if (!hours || Object.keys(hours).length === 0) {
    return {
      handled: true,
      intent:  'opening_hours',
      answer:  'Wir haben Montag bis Freitag von 09:00 bis 18:00 Uhr und Samstag von 09:00 bis 15:00 Uhr geöffnet.',
    };
  }

  const berlin   = getBerlinTime();
  const openNow  = isCurrentlyOpen(hours, berlin);
  const today    = hours[berlin.weekday];
  const hoursStr = buildOpeningHoursString(hours);

  let answer: string;
  if (openNow && today) {
    answer = `Ja, wir haben gerade geöffnet! Heute bis ${formatTime(today.close)}. Unsere Öffnungszeiten: ${hoursStr}.`;
  } else if (!openNow && today) {
    answer = `Wir sind gerade geschlossen. Heute öffnen wir um ${formatTime(today.open)}. Unsere Öffnungszeiten: ${hoursStr}.`;
  } else {
    answer = `Unsere Öffnungszeiten: ${hoursStr}.`;
  }

  return {
    handled:  true,
    intent:   'opening_hours',
    answer,
    metadata: { open_now: openNow, today: today ?? null },
  };
}

async function resolveServicesList(tenantId: string): Promise<SalonKnowledgeResult> {
  const groups = await getServicesByTenant(tenantId);
  if (groups.length === 0) {
    return {
      handled: true,
      intent:  'services_list',
      answer:  'Leider kann ich gerade keine Leistungen abrufen. Bitte fragen Sie uns direkt.',
    };
  }

  const lines = groups.flatMap((g) =>
    g.services.map((s) => `${s.name} (${s.duration_minutes} Min., ${centToEuro(s.price_cents)})`),
  );
  const answer = `Wir bieten folgende Leistungen an: ${lines.join(', ')}.`;

  return {
    handled:  true,
    intent:   'services_list',
    answer,
    metadata: { service_count: lines.length },
  };
}

async function resolveServiceDuration(
  tenantId: string,
  question: string,
): Promise<SalonKnowledgeResult> {
  const groups = await getServicesByTenant(tenantId);
  const allServices = groups.flatMap((g) => g.services);

  // Try to match a service name in the question
  const q       = question.toLowerCase();
  const matched = allServices.filter((s) => q.includes(s.name.toLowerCase()));

  if (matched.length === 0) {
    const summary = allServices
      .map((s) => `${s.name}: ${s.duration_minutes} Min.`)
      .join(', ');
    return {
      handled: true,
      intent:  'service_duration',
      answer:  `Die Dauer unserer Leistungen: ${summary}.`,
    };
  }

  const service = matched[0];
  return {
    handled:  true,
    intent:   'service_duration',
    answer:   `${service.name} dauert ca. ${service.duration_minutes} Minuten.`,
    metadata: { service_id: service.id, duration_minutes: service.duration_minutes },
  };
}

async function resolveServicePrice(
  tenantId: string,
  question: string,
): Promise<SalonKnowledgeResult> {
  const groups      = await getServicesByTenant(tenantId);
  const allServices = groups.flatMap((g) => g.services);

  const q       = question.toLowerCase();
  const matched = allServices.filter((s) => q.includes(s.name.toLowerCase()));

  if (matched.length === 0) {
    const summary = allServices
      .map((s) => `${s.name}: ${centToEuro(s.price_cents)}`)
      .join(', ');
    return {
      handled: true,
      intent:  'service_price',
      answer:  `Unsere Preise: ${summary}.`,
    };
  }

  const service = matched[0];
  return {
    handled:  true,
    intent:   'service_price',
    answer:   `${service.name} kostet ${centToEuro(service.price_cents)}.`,
    metadata: { service_id: service.id, price_cents: service.price_cents },
  };
}

async function resolveStylistAvailability(
  tenantId: string,
  question: string,
): Promise<SalonKnowledgeResult> {
  const stylists = await getStylistsByTenant(tenantId);

  if (stylists.length === 0) {
    return {
      handled: true,
      intent:  'stylist_availability',
      answer:  'Leider kann ich gerade keine Mitarbeiterdaten abrufen.',
    };
  }

  // Try to find a stylist name in the question
  const q       = question.toLowerCase();
  const matched = stylists.filter((s) => q.includes(s.name.toLowerCase()));

  if (matched.length === 1) {
    const s = matched[0];
    return {
      handled:  true,
      intent:   'stylist_availability',
      // Heuristic: we cannot query a real calendar here — give a helpful non-commital answer
      answer:   `${s.name} ist grundsätzlich bei uns tätig. Für genaue Verfügbarkeit beim Buchen eines Termins kann ich Ihnen helfen.`,
      metadata: { stylist_id: s.id, stylist_name: s.name },
    };
  }

  const names = stylists.map((s) => s.name).join(', ');
  return {
    handled:  true,
    intent:   'stylist_availability',
    answer:   `Unsere Stylisten sind: ${names}. Soll ich bei einem bestimmten Stylist buchen?`,
    metadata: { stylist_count: stylists.length },
  };
}

async function resolveTodayAppointment(tenantId: string): Promise<SalonKnowledgeResult> {
  const settings = await getSalonSettings(tenantId);
  const hours    = settings.opening_hours;
  const berlin   = getBerlinTime();
  const today    = hours?.[berlin.weekday];

  if (!today) {
    return {
      handled: true,
      intent:  'today_appointment',
      answer:  'Leider haben wir heute keinen Terminbetrieb. Bitte versuchen Sie es an einem anderen Tag.',
    };
  }

  const [closeH, closeM] = today.close.split(':').map(Number);
  const nowMins          = berlin.hour * 60 + berlin.minute;
  const closeMins        = closeH * 60 + closeM;
  const remainingMin     = closeMins - nowMins;

  if (remainingMin <= 30) {
    return {
      handled: true,
      intent:  'today_appointment',
      answer:  `Wir schließen heute um ${formatTime(today.close)}. Leider ist es kurzfristig schwierig, heute noch einen Termin einzuplanen. Wie wäre morgen?`,
    };
  }

  return {
    handled: true,
    intent:  'today_appointment',
    answer:  `Ich kann versuchen, heute noch einen Termin für Sie zu finden — wir haben bis ${formatTime(today.close)} geöffnet. Welche Leistung möchten Sie?`,
  };
}

// ── Main entry point ──────────────────────────────────────────────────────────

export async function resolveSalonKnowledge(
  tenantId: string,
  question: string,
): Promise<SalonKnowledgeResult> {
  const intent = detectSalonIntent(question);

  switch (intent) {
    case 'opening_hours':       return resolveOpeningHours(tenantId);
    case 'services_list':       return resolveServicesList(tenantId);
    case 'service_duration':    return resolveServiceDuration(tenantId, question);
    case 'service_price':       return resolveServicePrice(tenantId, question);
    case 'stylist_availability': return resolveStylistAvailability(tenantId, question);
    case 'today_appointment':   return resolveTodayAppointment(tenantId);
    default:
      return { handled: false, intent: 'unknown' };
  }
}
