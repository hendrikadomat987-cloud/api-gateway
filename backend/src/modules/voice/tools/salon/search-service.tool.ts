// src/modules/voice/tools/salon/search-service.tool.ts
//
// search_service — searches services by name/description keyword.
// Analogous to restaurant/search-menu-item.tool.ts.

import type { VoiceContext } from '../../../../types/voice.js';
import { searchServices } from '../../repositories/salon-services.repository.js';

export async function runSearchService(
  context: VoiceContext,
  args: Record<string, unknown>,
): Promise<unknown> {
  const query = typeof args.query === 'string' ? args.query.trim() : '';

  if (query.length === 0) {
    return { success: false, error: 'missing_query', message: 'query is required.' };
  }

  const results = await searchServices(context.tenantId, query);

  return {
    success: true,
    query,
    count:   results.length,
    results: results.map((s) => ({
      id:               s.id,
      name:             s.name,
      category:         s.category,
      description:      s.description,
      duration_minutes: s.duration_minutes,
      price:            s.price,
      price_cents:      s.price_cents,
    })),
  };
}
