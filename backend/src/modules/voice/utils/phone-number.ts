// src/modules/voice/utils/phone-number.ts

/**
 * Normalises a phone number to E.164 format for consistent lookup.
 *
 * TODO: Integrate a proper phone number library (e.g. libphonenumber-js)
 * for international number parsing.
 */
export function normalizeToE164(raw: string): string {
  // Strip whitespace and common formatting characters
  const stripped = raw.replace(/[\s\-().]/g, '');

  // If it looks like a local number without country code, leave as-is for now
  // TODO: Apply country code defaulting based on tenant locale/config
  if (!stripped.startsWith('+')) {
    return stripped;
  }

  return stripped;
}

/** Returns true if the string looks like a plausible phone number. */
export function isValidPhoneNumber(raw: string): boolean {
  const normalized = normalizeToE164(raw);
  // TODO: Replace with libphonenumber-js validation
  return /^\+?[1-9]\d{6,14}$/.test(normalized);
}
