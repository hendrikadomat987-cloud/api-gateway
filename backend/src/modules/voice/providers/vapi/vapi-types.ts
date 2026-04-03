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
  createdAt: string;
  updatedAt: string;
  type?: string;
  status?: string;
  phoneNumberId?: string;
  assistantId?: string;
  customer?: {
    number?: string;
    name?: string;
  };
  phoneNumber?: {
    number?: string;
  };
}

export interface VapiToolCallFunction {
  name: string;
  arguments: Record<string, unknown>;
}

export interface VapiToolCall {
  id: string;
  type: 'function';
  function: VapiToolCallFunction;
}

export interface VapiBaseMessage {
  type: VapiMessageType;
  call: VapiCallObject;
  timestamp?: string;
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
