// src/modules/voice/tools/restaurant/resolve-modifiers.ts
import { findModifierByNameAndType } from '../../repositories/restaurant-modifier.repository.js';
import type { OrderItemModifier, OrderModifierInput } from '../../../../types/voice.js';

export interface ResolvedModifiers {
  modifiers: OrderItemModifier[];
  error?: { code: string; modifier: string };
}

/**
 * Resolves a list of raw modifier inputs against the tenant modifier catalog.
 *
 * Rules:
 *   - free_text: always accepted as-is, price_delta = 0, no catalog lookup
 *   - add / remove: must exist in catalog; if not → returns error
 *
 * Returns on the first unrecognised modifier (fail-fast).
 */
export async function resolveModifiers(
  tenantId: string,
  inputs: OrderModifierInput[],
): Promise<ResolvedModifiers> {
  const modifiers: OrderItemModifier[] = [];

  for (const input of inputs) {
    if (input.type === 'free_text') {
      modifiers.push({ type: 'free_text', name: input.name, price_delta: 0 });
      continue;
    }

    const entry = await findModifierByNameAndType(tenantId, input.name, input.type);

    if (!entry) {
      return {
        modifiers: [],
        error: { code: 'modifier_not_found', modifier: input.name },
      };
    }

    modifiers.push({
      modifier_id: entry.id,
      type:        entry.type,
      name:        entry.name,
      price_delta: entry.price_cents / 100,
    });
  }

  return { modifiers };
}

/**
 * Parses and validates the raw `modifiers` arg from tool input.
 * Returns an empty array when modifiers are absent or not an array.
 * Invalid shape items are silently skipped (the voice payload may be imprecise).
 */
export function parseModifierInputs(raw: unknown): OrderModifierInput[] {
  if (!Array.isArray(raw)) return [];

  const result: OrderModifierInput[] = [];
  for (const item of raw) {
    if (
      item !== null &&
      typeof item === 'object' &&
      typeof (item as Record<string, unknown>).type === 'string' &&
      typeof (item as Record<string, unknown>).name === 'string' &&
      ['add', 'remove', 'free_text'].includes((item as Record<string, unknown>).type as string)
    ) {
      result.push({
        type: (item as Record<string, unknown>).type as OrderModifierInput['type'],
        name: (item as Record<string, unknown>).name as string,
      });
    }
  }
  return result;
}
