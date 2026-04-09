// src/modules/voice/orchestration/resolve-tool.ts
import { VoiceToolNotAllowedError } from '../../../errors/voice-errors.js';
import { updateSession } from '../repositories/voice-sessions.repository.js';
import type { VoiceContext, ToolInput, ToolResult } from '../../../types/voice.js';
import { featureService } from '../../features/services/feature.service.js';
import { getRequiredFeature } from './tool-feature-map.js';

// ── Booking tools ─────────────────────────────────────────────────────────────

import { runCheckAvailability } from '../tools/booking/check-availability.tool.js';
import { runGetNextFree } from '../tools/booking/get-next-free.tool.js';
import { runBookAppointment } from '../tools/booking/book-appointment.tool.js';
import { runAnswerBookingQuestion } from '../tools/booking/answer-booking-question.tool.js';
import { runCreateCallbackRequest } from '../tools/booking/create-callback-request.tool.js';

// ── Salon tools ───────────────────────────────────────────────────────────────

import { runGetServices }            from '../tools/salon/get-services.tool.js';
import { runSearchService }          from '../tools/salon/search-service.tool.js';
import { runCreateBooking }          from '../tools/salon/create-booking.tool.js';
import { runAddBookingService }      from '../tools/salon/add-booking-service.tool.js';
import { runUpdateBookingService }   from '../tools/salon/update-booking-service.tool.js';
import { runRemoveBookingService }   from '../tools/salon/remove-booking-service.tool.js';
import { runConfirmBooking }         from '../tools/salon/confirm-booking.tool.js';
import { runGetBookingSummary }      from '../tools/salon/get-booking-summary.tool.js';
import { runAnswerBookingQuestion as runAnswerSalonQuestion } from '../tools/salon/answer-booking-question.tool.js';

// ── Restaurant tools ──────────────────────────────────────────────────────────

import { runGetMenu } from '../tools/restaurant/get-menu.tool.js';
import { runSearchMenuItem } from '../tools/restaurant/search-menu-item.tool.js';
import { runAnswerMenuQuestion } from '../tools/restaurant/answer-menu-question.tool.js';
import { runCreateOrder } from '../tools/restaurant/create-order.tool.js';
import { runAddOrderItem } from '../tools/restaurant/add-order-item.tool.js';
import { runUpdateOrderItem } from '../tools/restaurant/update-order-item.tool.js';
import { runConfirmOrder } from '../tools/restaurant/confirm-order.tool.js';
import { runCreateRestaurantCallbackRequest } from '../tools/restaurant/create-restaurant-callback-request.tool.js';
import { runRemoveOrderItem } from '../tools/restaurant/remove-order-item.tool.js';
import { runGetOrderSummary } from '../tools/restaurant/get-order-summary.tool.js';

// ── Dispatch maps ─────────────────────────────────────────────────────────────

type ToolHandler = (ctx: VoiceContext, args: Record<string, unknown>) => Promise<unknown>;

const BOOKING_TOOLS: Record<string, ToolHandler> = {
  check_availability: runCheckAvailability,
  get_next_free: runGetNextFree,
  book_appointment: runBookAppointment,
  answer_booking_question: runAnswerBookingQuestion,
  create_callback_request: runCreateCallbackRequest,
};

const RESTAURANT_TOOLS: Record<string, ToolHandler> = {
  get_menu: runGetMenu,
  search_menu_item: runSearchMenuItem,
  answer_menu_question: runAnswerMenuQuestion,
  create_order: runCreateOrder,
  add_order_item: runAddOrderItem,
  update_order_item: runUpdateOrderItem,
  confirm_order: runConfirmOrder,
  remove_order_item: runRemoveOrderItem,
  get_order_summary: runGetOrderSummary,
  create_restaurant_callback_request: runCreateRestaurantCallbackRequest,
};

const SALON_TOOLS: Record<string, ToolHandler> = {
  get_services:           runGetServices,
  search_service:         runSearchService,
  create_booking:         runCreateBooking,
  add_booking_service:    runAddBookingService,
  update_booking_service: runUpdateBookingService,
  remove_booking_service: runRemoveBookingService,
  confirm_booking:        runConfirmBooking,
  get_booking_summary:    runGetBookingSummary,
  answer_booking_question: runAnswerSalonQuestion,
};

const TOOL_REGISTRY: Record<string, Record<string, ToolHandler>> = {
  booking:    BOOKING_TOOLS,
  restaurant: RESTAURANT_TOOLS,
  salon:      SALON_TOOLS,
};

// ── Public dispatch ───────────────────────────────────────────────────────────

/**
 * Dispatches a list of tool inputs to the correct handler for the current track.
 * Each tool is executed independently; failures are captured per-tool.
 *
 * Gating order:
 *   1. Track check — is the tool registered for this track at all?
 *   2. Feature check — does the tenant have the required feature enabled?
 *   3. Tool execution
 */
export async function dispatchTools(
  context: VoiceContext,
  tools: ToolInput[],
): Promise<ToolResult[]> {
  const trackMap = TOOL_REGISTRY[context.track];
  if (!trackMap) throw new VoiceToolNotAllowedError(`track:${context.track}`);

  // Fetch all enabled features once for this tenant — avoids N DB round-trips
  // when multiple tools are dispatched in the same request.
  const enabledFeatures = new Set(
    await featureService.getTenantFeatures(context.tenantId),
  );

  return Promise.all(
    tools.map(async (tool): Promise<ToolResult> => {
      // Layer 1: track-level gate
      const handler = trackMap[tool.name];
      if (!handler) {
        return {
          name: tool.name,
          success: false,
          error: `Tool not allowed in track '${context.track}': ${tool.name}`,
        };
      }

      // Layer 2: feature-level gate
      const requiredFeature = getRequiredFeature(tool.name, context.track);
      if (requiredFeature && !enabledFeatures.has(requiredFeature)) {
        return {
          name:    tool.name,
          success: false,
          error:   `Feature '${requiredFeature}' is not enabled for this tenant.`,
        };
      }

      // Layer 3: execute
      try {
        const result = await handler(context, tool.arguments);
        return { name: tool.name, success: true, result };
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Tool execution failed';
        await updateSession(context.tenantId, context.session.id, { status: 'failed' }).catch(() => undefined);
        return { name: tool.name, success: false, error: message };
      }
    }),
  );
}
