// src/modules/voice/providers/vapi/vapi-adapter.ts
import type { VapiWebhookPayload, VapiWebhookMessage } from './vapi-types.js';
import type { ToolInput } from '../../../../types/voice.js';

/**
 * Adapts raw VAPI webhook payloads into the internal voice domain model.
 * All VAPI-specific shape knowledge is contained here.
 */

export function extractMessage(payload: VapiWebhookPayload): VapiWebhookMessage {
  // TODO: Add deeper structural validation if needed beyond schema validation.
  return payload.message;
}

export function extractCallerId(message: VapiWebhookMessage): string | undefined {
  return message.call.customer?.number;
}

export function extractCalledNumber(message: VapiWebhookMessage): string | undefined {
  return message.call.phoneNumber?.number;
}

export function extractProviderAgentId(message: VapiWebhookMessage): string | undefined {
  return message.call.assistantId;
}

export function extractProviderCallId(message: VapiWebhookMessage): string {
  return message.call.id;
}

/**
 * Extracts tool call inputs from a VAPI tool-calls message.
 * Returns an empty array for non-tool messages.
 */
export function extractToolInputs(message: VapiWebhookMessage): ToolInput[] {
  if (message.type !== 'tool-calls') return [];

  const toolCallsMessage = message as import('./vapi-types.js').VapiToolCallsMessage;
  return toolCallsMessage.toolCallList.map((tc) => ({
    name: tc.function.name,
    arguments: tc.function.arguments,
    _vapiToolCallId: tc.id, // retained for response mapping
  })) as ToolInput[];
}

/**
 * Builds the VAPI-shaped response body for tool call results.
 */
export function buildToolCallsResponse(
  results: Array<{ tool_call_id?: string; name: string; success: boolean; result?: unknown; error?: string }>,
): import('./vapi-types.js').VapiToolCallsResponse {
  return {
    results: results.map((r) => ({
      toolCallId: r.tool_call_id ?? '',
      result: r.success ? r.result : { error: r.error ?? 'Tool execution failed' },
    })),
  };
}
