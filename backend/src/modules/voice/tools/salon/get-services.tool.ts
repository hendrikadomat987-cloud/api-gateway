// src/modules/voice/tools/salon/get-services.tool.ts
//
// get_services — returns the full active service catalogue grouped by category.
// Analogous to restaurant/get-menu.tool.ts.

import type { VoiceContext } from '../../../../types/voice.js';
import { getServicesByTenant } from '../../repositories/salon-services.repository.js';

export async function runGetServices(
  context: VoiceContext,
  _args: Record<string, unknown>,
): Promise<unknown> {
  const groups = await getServicesByTenant(context.tenantId);

  return {
    success:  true,
    categories: groups.map((g) => ({
      name:     g.category,
      services: g.services.map((s) => ({
        id:               s.id,
        name:             s.name,
        description:      s.description,
        duration_minutes: s.duration_minutes,
        price:            s.price,
        price_cents:      s.price_cents,
      })),
    })),
  };
}
