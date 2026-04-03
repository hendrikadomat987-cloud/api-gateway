// src/types/voice.ts

// ── Provider / Agent / Number status ─────────────────────────────────────────

export type VoiceProviderStatus = 'active' | 'inactive' | 'disabled';

export type VoiceAgentStatus = 'active' | 'inactive' | 'draft';

export type VoiceNumberStatus = 'active' | 'inactive' | 'disabled';

// ── Call ──────────────────────────────────────────────────────────────────────

export type VoiceProviderType = 'vapi';

export type VoiceCallDirection = 'inbound' | 'outbound';

export type VoiceCallStatus =
  | 'created'
  | 'ringing'
  | 'in_progress'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'fallback'
  | 'handover';

export type VoiceTrackType = 'booking' | 'restaurant' | 'unknown';

// ── Session ───────────────────────────────────────────────────────────────────

export type VoiceSessionStatus =
  | 'active'
  | 'awaiting_user_input'
  | 'awaiting_confirmation'
  | 'completed'
  | 'fallback'
  | 'handover'
  | 'cancelled'
  | 'failed';

export type VoiceSessionTrackType = 'booking' | 'restaurant';

// ── Events / Tools / Order ────────────────────────────────────────────────────

export type VoiceEventProcessingStatus =
  | 'received'
  | 'normalized'
  | 'processed'
  | 'failed'
  | 'ignored'
  | 'dead_letter';

export type VoiceToolInvocationStatus = 'started' | 'succeeded' | 'failed' | 'cancelled';

export type VoiceOrderContextStatus =
  | 'draft'
  | 'awaiting_confirmation'
  | 'confirmed'
  | 'cancelled'
  | 'failed';

export type VoiceCallbackRequestStatus =
  | 'pending'
  | 'forwarded'
  | 'completed'
  | 'failed';

// ── Known internal event_type values (documentation / exhaustiveness helper) ──
//
// VoiceEvent.event_type is typed as `string` on the DB interface because the
// spec defines it as a free TEXT column ("internes Event"). This union is a
// non-exhaustive catalogue of well-known values used in the codebase — it does
// NOT constrain the DB column.
//
export type KnownVoiceEventType =
  | 'call.started'
  | 'call.ended'
  | 'call.failed'
  | 'call.status_update'
  | 'call.hang'
  | 'speech.user'
  | 'speech.assistant'
  | 'tool.invoked'
  | 'tool.result'
  | 'session.created'
  | 'session.updated';

// ── Runtime track shorthand ───────────────────────────────────────────────────

/** Validated V1 track — never includes 'unknown'. Used in the runtime context. */
export type VoiceTrack = 'booking' | 'restaurant';

// ── Core domain objects (aligned with DB schema) ──────────────────────────────

export interface VoiceProviderRecord {
  id: string;
  tenant_id: string;
  provider_type: VoiceProviderType;
  name: string;
  status: VoiceProviderStatus;
  config_ref?: string;
  webhook_signing_mode?: string;
  created_at: string;
  updated_at: string;
}

export interface VoiceAgent {
  id: string;
  tenant_id: string;
  voice_provider_id: string;
  provider_agent_id: string;
  name: string;
  language?: string;
  status: VoiceAgentStatus;
  track_scope?: VoiceTrack | 'multi';
  default_prompt_profile_key?: string;
  created_at: string;
  updated_at: string;
}

export interface VoiceNumber {
  id: string;
  tenant_id: string;
  voice_provider_id: string;
  voice_agent_id?: string;
  phone_number: string;
  provider_number_id?: string;
  status: VoiceNumberStatus;
  is_primary: boolean;
  created_at: string;
  updated_at: string;
}

export interface VoiceCall {
  id: string;
  tenant_id: string;
  voice_provider_id: string;
  voice_agent_id?: string;
  voice_number_id?: string;
  provider_call_id: string;
  direction: VoiceCallDirection;
  caller_number?: string;
  callee_number?: string;
  status: VoiceCallStatus;
  track_type?: VoiceTrackType;
  started_at?: string;
  ended_at?: string;
  duration_seconds?: number;
  summary?: string;
  fallback_reason?: string;
  handover_reason?: string;
  created_at: string;
  updated_at: string;
}

export interface VoiceSession {
  id: string;
  tenant_id: string;
  voice_call_id: string;
  session_key?: string;
  status: VoiceSessionStatus;
  track_type: VoiceSessionTrackType;
  current_intent?: string;
  current_step?: string;
  context_json: Record<string, unknown>;
  last_user_message?: string;
  last_assistant_message?: string;
  started_at?: string;
  ended_at?: string;
  created_at: string;
  updated_at: string;
}

export interface VoiceEvent {
  id: string;
  tenant_id: string;
  voice_call_id?: string;
  voice_session_id?: string;
  voice_provider_id: string;
  provider_event_id?: string;
  event_type: string;
  event_ts?: string;
  raw_payload_json: Record<string, unknown>;
  normalized_payload_json?: Record<string, unknown>;
  processing_status: VoiceEventProcessingStatus;
  processing_error_code?: string;
  processing_error_message?: string;
  retry_count: number;
  last_retry_at?: string;
  created_at: string;
}

export interface VoiceToolInvocation {
  id: string;
  tenant_id: string;
  voice_call_id: string;
  voice_session_id: string;
  tool_name: string;
  track_type: VoiceSessionTrackType;
  request_payload_json: Record<string, unknown>;
  response_payload_json?: Record<string, unknown>;
  status: VoiceToolInvocationStatus;
  error_code?: string;
  error_message?: string;
  started_at?: string;
  finished_at?: string;
  created_at: string;
}

export interface VoiceOrderContext {
  id: string;
  tenant_id: string;
  voice_call_id: string;
  voice_session_id: string;
  status: VoiceOrderContextStatus;
  order_context_json: Record<string, unknown>;
  confirmed_at?: string;
  created_at: string;
  updated_at: string;
}

export interface VoiceCallbackRequest {
  id: string;
  tenant_id: string;
  voice_call_id: string;
  voice_session_id: string;
  track_type: VoiceSessionTrackType;
  caller_number: string;
  preferred_time?: string;
  notes?: string;
  status: VoiceCallbackRequestStatus;
  n8n_workflow_id?: string;
  created_at: string;
  updated_at: string;
}

// ── Runtime context ───────────────────────────────────────────────────────────

/** Resolved per-request context after tenant resolution. Never trust from payload. */
export interface VoiceContext {
  tenantId: string;
  agent: VoiceAgent;
  track: VoiceTrack;
  call: VoiceCall;
  session: VoiceSession;
}

// ── Tool contracts ────────────────────────────────────────────────────────────

export interface ToolInput {
  name: string;
  arguments: Record<string, unknown>;
}

export interface ToolResult {
  tool_call_id?: string;
  name: string;
  success: boolean;
  result?: unknown;
  error?: string;
}
