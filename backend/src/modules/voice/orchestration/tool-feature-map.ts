// src/modules/voice/orchestration/tool-feature-map.ts
//
// Maps every voice tool name to the feature key required to execute it.
// Used by dispatchTools() in resolve-tool.ts to gate tool execution.
//
// Rules:
//   • A tool with no entry in this map is allowed unconditionally (no gating).
//   • A tool with an entry requires the tenant to have that feature enabled.
//   • Track-level gating (TOOL_REGISTRY) still runs first; this is a second
//     layer that gates based on tenant feature entitlements.
//
// Phase 2 note: tools mapped to 'salon.availability' will need a real
// availability engine integration; for Phase 1 the feature key is reserved
// so gating is correct from day one.

export const TOOL_FEATURE_MAP: Readonly<Record<string, string>> = {
  // ── Booking track ─────────────────────────────────────────────────────────
  check_availability:      'booking.availability',
  get_next_free:           'booking.availability',
  book_appointment:        'booking.core',
  answer_booking_question: 'booking.faq',
  create_callback_request: 'voice.callback',

  // ── Restaurant track ──────────────────────────────────────────────────────
  get_menu:                          'restaurant.menu',
  search_menu_item:                  'restaurant.menu',
  answer_menu_question:              'restaurant.core',
  create_order:                      'restaurant.ordering',
  add_order_item:                    'restaurant.ordering',
  update_order_item:                 'restaurant.ordering',
  confirm_order:                     'restaurant.ordering',
  remove_order_item:                 'restaurant.ordering',
  get_order_summary:                 'restaurant.ordering',
  create_restaurant_callback_request:'voice.callback',

  // ── Salon track ───────────────────────────────────────────────────────────
  get_services:            'salon.core',
  search_service:          'salon.core',
  create_booking:          'salon.booking',
  add_booking_service:     'salon.booking',
  update_booking_service:  'salon.booking',
  remove_booking_service:  'salon.booking',
  confirm_booking:         'salon.booking',
  get_booking_summary:     'salon.booking',
  // answer_booking_question is shared between booking and salon tracks (same tool name).
  // It is NOT in this map because the required feature differs per track:
  //   booking track → 'booking.faq'
  //   salon track   → 'salon.core'
  // The disambiguation lives entirely in getRequiredFeature() below via a special
  // case. The booking track entry at the top of this map is irrelevant for the
  // salon context — track-level gating ensures it never reaches the wrong handler.
};

/**
 * Returns the feature key required to execute a given tool.
 * Returns null when the tool has no feature requirement (unrestricted).
 *
 * @param toolName  - The tool function name from the VAPI payload.
 * @param track     - The current session track ('booking' | 'restaurant' | 'salon').
 *                    Used to disambiguate tools that exist in multiple tracks
 *                    with different feature requirements.
 */
export function getRequiredFeature(toolName: string, track: string): string | null {
  // Special-case: answer_booking_question exists in both booking and salon tracks.
  // In booking context it requires booking.faq; in salon context it requires salon.core.
  if (toolName === 'answer_booking_question') {
    return track === 'salon' ? 'salon.core' : 'booking.faq';
  }
  return TOOL_FEATURE_MAP[toolName] ?? null;
}
