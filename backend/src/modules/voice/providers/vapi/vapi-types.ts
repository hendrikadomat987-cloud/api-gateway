// src/modules/voice/providers/vapi/vapi-types.ts

// ── VAPI webhook message types ────────────────────────────────────────────────

export type VapiMessageType =
  | 'assistant-request'
  | 'function-call'
  | 'end-of-call-report'
  | 'speech-update'
  | 'transcript'
  | 'hang'
  | 'tool-calls'
  | 'status-update';

export interface VapiCallObject {
  id: string;
  orgId?: string;
  // Vapi omits createdAt/updatedAt on some event types (e.g. status-update mid-call)
  createdAt?: string;
  updatedAt?: string;
  type?: string;
  status?: string;
  phoneNumberId?: string;
  assistantId?: string;
  // Vapi sends these as explicit null on end-of-call-report when the call ended
  // before the fields were populated (e.g. SIP-completed calls).
  customer?: {
    number?: string;
    name?: string;
    sipUri?: string;
  } | null;
  phoneNumber?: {
    number?: string;
  } | null;
}

export interface VapiToolCallFunction {
  name: string;
  // Real Vapi payloads may serialize arguments as a JSON string; callers must
  // parse the string form before using it as a Record.
  arguments: Record<string, unknown> | string;
}

export interface VapiToolCall {
  id: string;
  type: 'function';
  function: VapiToolCallFunction;
}

export interface VapiBaseMessage {
  type: VapiMessageType;
  call: VapiCallObject;
  // Vapi sends timestamp as a Unix-millisecond number on real payloads; some
  // synthetic/older events use an ISO-8601 string — accept both.
  timestamp?: string | number;
}

export interface VapiToolCallsMessage extends VapiBaseMessage {
  type: 'tool-calls';
  toolCallList: VapiToolCall[];
}

export interface VapiFunctionCallMessage extends VapiBaseMessage {
  type: 'function-call';
  functionCall: {
    name: string;
    parameters: Record<string, unknown>;
  };
}

export interface VapiEndOfCallReportMessage extends VapiBaseMessage {
  type: 'end-of-call-report';
  endedReason?: string;
  summary?: string;
  transcript?: string;
  durationSeconds?: number;
  cost?: number;
}

export interface VapiStatusUpdateMessage extends VapiBaseMessage {
  type: 'status-update';
  status?: string;
}

export type VapiWebhookMessage =
  | VapiToolCallsMessage
  | VapiFunctionCallMessage
  | VapiEndOfCallReportMessage
  | VapiStatusUpdateMessage
  | VapiBaseMessage;

// ── VAPI tool call response shape ─────────────────────────────────────────────

export interface VapiToolCallResult {
  toolCallId: string;
  result: unknown;
}

export interface VapiToolCallsResponse {
  results: VapiToolCallResult[];
}

// ── VAPI webhook envelope ─────────────────────────────────────────────────────

export interface VapiWebhookPayload {
  message: VapiWebhookMessage;
}
