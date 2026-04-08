// src/modules/voice/tools/restaurant/knowledge-resolver.ts
//
// Deterministic knowledge layer for restaurant FAQ questions.
// Answers common questions directly from DB data before falling back to LLM.

import {
  getRestaurantSettings,
  getDeliveryZoneSummary,
} from '../../repositories/restaurant-settings.repository.js';
import { findDeliveryZone } from '../../repositories/restaurant-delivery.repository.js';

// ── Types ─────────────────────────────────────────────────────────────────────

export type KnowledgeIntent =
  | 'opening_hours'
  | 'delivery_area'
  | 'min_order'
  | 'delivery_fee'
  | 'delivery_time'
  | 'unknown';

export interface KnowledgeResult {
  handled:   boolean;
  intent:    KnowledgeIntent;
  answer?:   string;
  metadata?: Record<string, unknown>;
}

// ── Intent detection ──────────────────────────────────────────────────────────

// Each pattern is tested case-insensitively against the full question string.
const INTENT_PATTERNS: Array<{ intent: KnowledgeIntent; patterns: RegExp[] }> = [
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
    intent: 'delivery_area',
    patterns: [
      /\b(liefert?|lieferst?)\s+(ihr|du|man)?\s*(nach|in|zu)?\s*\d{5}\b/i,
      /\b\d{5}\b.*\b(liefer|zustellung)\b/i,
      /\b(liefert?|lieferst?)\s*(ihr|du|man)?\b/i,
      /\b(lieferzone|liefergebiet|lieferbereich|liefert ihr)\b/i,
    ],
  },
  {
    intent: 'min_order',
    patterns: [
      /\b(mindestbestellwert|mindestbestellung|mindestbetrag|mindestmenge)\b/i,
      /\bmindest.{0,10}bestel\b/i,
      /\bminimum.{0,10}(bestell|bestellung)\b/i,
    ],
  },
  {
    intent: 'delivery_fee',
    patterns: [
      /\b(lieferkosten|liefergeb[üu]hr|versandkosten|zustellgeb[üu]hr)\b/i,
      /kost\w*\s.{0,25}liefer/i,  // "Was kostet die Lieferung"
      /liefer\w*\s.{0,25}kost/i,  // "Lieferung kostet wie viel"
    ],
  },
  {
    intent: 'delivery_time',
    patterns: [
      /\b(wie lange|wie lang)\b/i,
      /\b(wartezeit|lieferzeit|abholzeit)\b/i,
      /\b(wann kommt|wann ist)\b/i,
      /\b(dauert.{0,20}(es|das|liefer|bestell|abholz))\b/i,
      /\b(eta|voraussichtlich)\b/i,
    ],
  },
];

/**
 * Detects the primary intent from a free-text question.
 * Returns the first matching intent in priority order (most specific first).
 */
export function detectIntent(question: string): KnowledgeIntent {
  const q = question.toLowerCase();
  for (const { intent, patterns } of INTENT_PATTERNS) {
    if (patterns.some((p) => p.test(q))) return intent;
  }
  return 'unknown';
}

/** Extracts the first 5-digit German postal code from a question, if present. */
function extractPostalCode(question: string): string | null {
  const match = question.match(/\b(\d{5})\b/);
  return match ? match[1] : null;
}

// ── Formatting helpers ────────────────────────────────────────────────────────

function centToEuro(cents: number): string {
  return (cents / 100).toFixed(2).replace('.', ',') + ' €';
}

function formatTime(t: string): string {
  // "11:00" → "11:00 Uhr"
  return t + ' Uhr';
}

// ── Opening hours helpers ─────────────────────────────────────────────────────

const WEEKDAY_NAMES_EN: Record<number, string> = {
  0: 'sunday',
  1: 'monday',
  2: 'tuesday',
  3: 'wednesday',
  4: 'thursday',
  5: 'friday',
  6: 'saturday',
};

const WEEKDAY_DE: Record<string, string> = {
  monday:    'Montag',
  tuesday:   'Dienstag',
  wednesday: 'Mittwoch',
  thursday:  'Donnerstag',
  friday:    'Freitag',
  saturday:  'Samstag',
  sunday:    'Sonntag',
};

interface BerlinTime {
  weekday: string;  // lowercase English
  hhmm:    string;  // "HH:MM"
  hour:    number;
  minute:  number;
}

function getBerlinTime(): BerlinTime {
  const now = new Date();
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
  const hhmm    = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;

  return { weekday, hhmm, hour, minute };
}

function isCurrentlyOpen(
  hours: Record<string, { open: string; close: string }>,
  berlin: BerlinTime,
): boolean {
  const today = hours[berlin.weekday];
  if (!today) return false;

  const [openH, openM]   = today.open.split(':').map(Number);
  const [closeH, closeM] = today.close.split(':').map(Number);

  const nowMins   = berlin.hour * 60 + berlin.minute;
  const openMins  = openH * 60 + openM;
  const closeMins = closeH * 60 + closeM;

  return nowMins >= openMins && nowMins < closeMins;
}

function buildOpeningHoursString(
  hours: Record<string, { open: string; close: string }>,
): string {
  // Group consecutive days with identical hours
  const days = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
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
      const dayLabel =
        g.days.length === 1
          ? WEEKDAY_DE[g.days[0]]
          : `${WEEKDAY_DE[g.days[0]]}–${WEEKDAY_DE[g.days[g.days.length - 1]]}`;
      return `${dayLabel} ${formatTime(g.open)}–${formatTime(g.close)}`;
    })
    .join(', ');
}

// ── Resolvers ─────────────────────────────────────────────────────────────────

async function resolveOpeningHours(tenantId: string): Promise<KnowledgeResult> {
  const settings = await getRestaurantSettings(tenantId);
  const hours    = settings.opening_hours;

  if (!hours || Object.keys(hours).length === 0) {
    return {
      handled: true,
      intent:  'opening_hours',
      answer:  'Wir haben täglich von 11:00 bis 22:00 Uhr geöffnet.',
    };
  }

  const berlin    = getBerlinTime();
  const openNow   = isCurrentlyOpen(hours, berlin);
  const todayKey  = berlin.weekday;
  const today     = hours[todayKey];
  const hoursStr  = buildOpeningHoursString(hours);

  let answer: string;

  if (openNow && today) {
    answer =
      `Ja, wir haben gerade geöffnet! Heute bis ${formatTime(today.close)}. ` +
      `Unsere Öffnungszeiten: ${hoursStr}.`;
  } else if (!openNow && today) {
    answer =
      `Wir sind gerade geschlossen. Heute öffnen wir um ${formatTime(today.open)} Uhr. ` +
      `Unsere Öffnungszeiten: ${hoursStr}.`;
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

async function resolveDeliveryArea(
  tenantId: string,
  question: string,
): Promise<KnowledgeResult> {
  const postalCode = extractPostalCode(question);

  if (postalCode) {
    const zone = await findDeliveryZone(tenantId, postalCode);
    if (zone) {
      return {
        handled:  true,
        intent:   'delivery_area',
        answer:   `Ja, wir liefern nach ${postalCode} (${zone.zone_name}). Die Liefergebühr beträgt ${centToEuro(zone.delivery_fee_cents)}.`,
        metadata: { postal_code: postalCode, zone_name: zone.zone_name, delivery_fee_cents: zone.delivery_fee_cents },
      };
    } else {
      return {
        handled:  true,
        intent:   'delivery_area',
        answer:   `Leider liefern wir nicht in die Postleitzahl ${postalCode}. Bitte wählen Sie eine andere PLZ oder bestellen Sie zur Abholung.`,
        metadata: { postal_code: postalCode, zone_found: false },
      };
    }
  }

  // No postal code in question — return general delivery area info
  const summary = await getDeliveryZoneSummary(tenantId);
  if (!summary) {
    return {
      handled: true,
      intent:  'delivery_area',
      answer:  'Wir bieten aktuell leider keine Lieferung an. Sie können aber gerne abholen!',
    };
  }

  const plzList = summary.postal_codes.join(', ');
  return {
    handled:  true,
    intent:   'delivery_area',
    answer:   `Wir liefern in folgende Postleitzahlen: ${plzList}. Die Liefergebühr beträgt ${centToEuro(summary.fee_cents_min)}${summary.fee_cents_max !== summary.fee_cents_min ? ` bis ${centToEuro(summary.fee_cents_max)}` : ''}.`,
    metadata: { postal_codes: summary.postal_codes },
  };
}

async function resolveMinOrder(tenantId: string): Promise<KnowledgeResult> {
  const summary = await getDeliveryZoneSummary(tenantId);
  if (!summary) {
    return {
      handled: true,
      intent:  'min_order',
      answer:  'Es gibt keinen Mindestbestellwert für Abholung.',
    };
  }

  return {
    handled:  true,
    intent:   'min_order',
    answer:   `Der Mindestbestellwert für Lieferungen beträgt ${centToEuro(summary.min_order_cents)}.`,
    metadata: { min_order_cents: summary.min_order_cents },
  };
}

async function resolveDeliveryFee(
  tenantId: string,
  question: string,
): Promise<KnowledgeResult> {
  const postalCode = extractPostalCode(question);

  if (postalCode) {
    const zone = await findDeliveryZone(tenantId, postalCode);
    if (zone) {
      return {
        handled:  true,
        intent:   'delivery_fee',
        answer:   `Die Liefergebühr für ${postalCode} beträgt ${centToEuro(zone.delivery_fee_cents)}.`,
        metadata: { postal_code: postalCode, delivery_fee_cents: zone.delivery_fee_cents },
      };
    }
  }

  const summary = await getDeliveryZoneSummary(tenantId);
  if (!summary) {
    return {
      handled: true,
      intent:  'delivery_fee',
      answer:  'Wir bieten aktuell keine Lieferung an.',
    };
  }

  const feeText =
    summary.fee_cents_min === summary.fee_cents_max
      ? centToEuro(summary.fee_cents_min)
      : `${centToEuro(summary.fee_cents_min)} bis ${centToEuro(summary.fee_cents_max)}`;

  return {
    handled:  true,
    intent:   'delivery_fee',
    answer:   `Die Liefergebühr beträgt ${feeText}, je nach Lieferzone.`,
    metadata: { fee_cents_min: summary.fee_cents_min, fee_cents_max: summary.fee_cents_max },
  };
}

async function resolveDeliveryTime(tenantId: string): Promise<KnowledgeResult> {
  const settings = await getRestaurantSettings(tenantId);

  const pickupMin   = settings.eta_pickup_min   ?? 15;
  const pickupMax   = settings.eta_pickup_max   ?? 20;
  const deliveryMin = settings.eta_delivery_min ?? 30;
  const deliveryMax = settings.eta_delivery_max ?? 45;

  return {
    handled:  true,
    intent:   'delivery_time',
    answer:   `Lieferungen dauern in der Regel ${deliveryMin}–${deliveryMax} Minuten. Für Abholung berechnen Sie ca. ${pickupMin}–${pickupMax} Minuten.`,
    metadata: { pickup_min: pickupMin, pickup_max: pickupMax, delivery_min: deliveryMin, delivery_max: deliveryMax },
  };
}

// ── Main entry point ──────────────────────────────────────────────────────────

/**
 * Resolves a free-text question to a deterministic, data-driven answer.
 * Returns `handled: false` when the question is not a recognized FAQ type,
 * allowing the caller to fall back to LLM or other handling.
 */
export async function resolveKnowledge(
  tenantId: string,
  question: string,
): Promise<KnowledgeResult> {
  const intent = detectIntent(question);

  switch (intent) {
    case 'opening_hours': return resolveOpeningHours(tenantId);
    case 'delivery_area': return resolveDeliveryArea(tenantId, question);
    case 'min_order':     return resolveMinOrder(tenantId);
    case 'delivery_fee':  return resolveDeliveryFee(tenantId, question);
    case 'delivery_time': return resolveDeliveryTime(tenantId);
    default:
      return { handled: false, intent: 'unknown' };
  }
}
