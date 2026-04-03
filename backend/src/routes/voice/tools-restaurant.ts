// src/routes/voice/tools-restaurant.ts
import type { FastifyInstance } from 'fastify';
import { getMenuTool } from '../../modules/voice/tools/restaurant/get-menu.tool.js';
import { searchMenuItemTool } from '../../modules/voice/tools/restaurant/search-menu-item.tool.js';
import { answerMenuQuestionTool } from '../../modules/voice/tools/restaurant/answer-menu-question.tool.js';
import { createOrderTool } from '../../modules/voice/tools/restaurant/create-order.tool.js';
import { addOrderItemTool } from '../../modules/voice/tools/restaurant/add-order-item.tool.js';
import { updateOrderItemTool } from '../../modules/voice/tools/restaurant/update-order-item.tool.js';
import { confirmOrderTool } from '../../modules/voice/tools/restaurant/confirm-order.tool.js';
import { createRestaurantCallbackRequestTool } from '../../modules/voice/tools/restaurant/create-restaurant-callback-request.tool.js';

/**
 * Restaurant tool routes (C.4.2).
 * In production, tools are dispatched programmatically via resolve-tool.ts, not via HTTP.
 * These routes exist for integration testing and direct tool invocation during development.
 */
export async function voiceToolsRestaurantRoutes(app: FastifyInstance): Promise<void> {
  app.post('/api/v1/voice/tools/restaurant/get-menu', getMenuTool);
  app.post('/api/v1/voice/tools/restaurant/search-menu-item', searchMenuItemTool);
  app.post('/api/v1/voice/tools/restaurant/answer-menu-question', answerMenuQuestionTool);
  app.post('/api/v1/voice/tools/restaurant/create-order', createOrderTool);
  app.post('/api/v1/voice/tools/restaurant/add-order-item', addOrderItemTool);
  app.post('/api/v1/voice/tools/restaurant/update-order-item', updateOrderItemTool);
  app.post('/api/v1/voice/tools/restaurant/confirm-order', confirmOrderTool);
  app.post('/api/v1/voice/tools/restaurant/create-callback-request', createRestaurantCallbackRequestTool);
}
