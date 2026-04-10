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
 * Normalises tc.function.arguments to a plain object.
 * Vapi may deliver arguments as either a parsed object OR a JSON string.
 * Never throws — returns {} on any parse failure.
 */
function normaliseArguments(raw: Record<string, unknown> | string): Record<string, unknown> {
  if (typeof raw !== 'string') return raw;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // malformed JSON — fall through to safe default
  }
  return {};
}

/**
 * Extracts tool call inputs from a VAPI tool-calls message.
 * Returns an empty array for non-tool messages.
 * Arguments are always normalised to Record<string, unknown>.
 */
export function extractToolInputs(message: VapiWebhookMessage): ToolInput[] {
  if (message.type !== 'tool-calls') return [];

  const toolCallsMessage = message as import('./vapi-types.js').VapiToolCallsMessage;
  return toolCallsMessage.toolCallList.map((tc) => ({
    name: tc.function.name,
    arguments: normaliseArguments(tc.function.arguments as Record<string, unknown> | string),
    _vapiToolCallId: tc.id, // retained for response mapping
  })) as ToolInput[];
}

/**
 * Builds the VAPI-shaped response body for tool call results.
 */
export function buildToolCallsResponse(
  results: Array<{ tool_call_id?: string; name: string; success: boolean; result?: unknown; error?: string | Record<string, unknown> }>,
): import('./vapi-types.js').VapiToolCallsResponse {
  return {
    results: results.map((r) => ({
      toolCallId: r.tool_call_id ?? '',
      result: r.success ? r.result : { success: false, error: r.error ?? 'Tool execution failed' },
    })),
  };
}
