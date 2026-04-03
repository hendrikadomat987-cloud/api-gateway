// src/errors/voice-errors.ts
import { AppError } from './index.js';

// ── Base class ────────────────────────────────────────────────────────────────

export class VoiceError extends AppError {
  constructor(statusCode: number, code: string, message: string, details?: unknown) {
    super(statusCode, code, message, details);
    this.name = 'VoiceError';
  }
}

// ── Provider / Ingress ────────────────────────────────────────────────────────

export class InvalidProviderSignatureError extends VoiceError {
  constructor(message = 'Invalid or missing provider signature') {
    super(401, 'INVALID_PROVIDER_SIGNATURE', message);
    this.name = 'InvalidProviderSignatureError';
  }
}

export class UnknownProviderError extends VoiceError {
  constructor(provider?: string) {
    super(400, 'UNKNOWN_PROVIDER', `Unknown or unsupported provider${provider ? `: ${provider}` : ''}`);
    this.name = 'UnknownProviderError';
  }
}

export class VoiceEventInvalidError extends VoiceError {
  constructor(message = 'Voice event payload is invalid', details?: unknown) {
    super(400, 'VOICE_EVENT_INVALID', message, details);
    this.name = 'VoiceEventInvalidError';
  }
}

// ── Tenant / Resolver ─────────────────────────────────────────────────────────

export class VoiceTenantNotResolvedError extends VoiceError {
  constructor(message = 'Cannot resolve tenant from voice call') {
    super(400, 'VOICE_TENANT_NOT_RESOLVED', message);
    this.name = 'VoiceTenantNotResolvedError';
  }
}

export class VoiceAgentNotFoundError extends VoiceError {
  constructor(ref?: string) {
    super(404, 'VOICE_AGENT_NOT_FOUND', `Voice agent not found${ref ? `: ${ref}` : ''}`);
    this.name = 'VoiceAgentNotFoundError';
  }
}

export class VoiceNumberNotFoundError extends VoiceError {
  constructor(phoneNumber?: string) {
    super(404, 'VOICE_NUMBER_NOT_FOUND', `Voice number not found${phoneNumber ? `: ${phoneNumber}` : ''}`);
    this.name = 'VoiceNumberNotFoundError';
  }
}

// ── Session / Runtime ─────────────────────────────────────────────────────────

export class VoiceEventNotFoundError extends VoiceError {
  constructor(eventId: string) {
    super(404, 'VOICE_EVENT_NOT_FOUND', `Voice event not found: ${eventId}`);
    this.name = 'VoiceEventNotFoundError';
  }
}

export class VoiceEventNotRetryableError extends VoiceError {
  constructor(eventId: string, status: string) {
    super(409, 'VOICE_EVENT_NOT_RETRYABLE', `Event ${eventId} is not retryable (status: ${status})`);
    this.name = 'VoiceEventNotRetryableError';
  }
}

export class VoiceCallNotFoundError extends VoiceError {
  constructor(callId: string) {
    super(404, 'VOICE_CALL_NOT_FOUND', `Voice call not found: ${callId}`);
    this.name = 'VoiceCallNotFoundError';
  }
}

export class VoiceSessionNotFoundError extends VoiceError {
  constructor(sessionId: string) {
    super(404, 'VOICE_SESSION_NOT_FOUND', `Voice session not found: ${sessionId}`);
    this.name = 'VoiceSessionNotFoundError';
  }
}

export class VoiceTrackNotResolvedError extends VoiceError {
  constructor(track?: string) {
    super(400, 'VOICE_TRACK_NOT_RESOLVED', `Voice track cannot be resolved${track ? `: ${track}` : ''}`);
    this.name = 'VoiceTrackNotResolvedError';
  }
}

// ── Tools ─────────────────────────────────────────────────────────────────────

export class VoiceToolNotAllowedError extends VoiceError {
  constructor(toolName: string) {
    super(400, 'VOICE_TOOL_NOT_ALLOWED', `Tool not allowed in this context: ${toolName}`);
    this.name = 'VoiceToolNotAllowedError';
  }
}

export class VoiceToolExecutionFailedError extends VoiceError {
  constructor(toolName: string, details?: unknown) {
    super(500, 'VOICE_TOOL_EXECUTION_FAILED', `Tool execution failed: ${toolName}`, details);
    this.name = 'VoiceToolExecutionFailedError';
  }
}

export class VoiceToolContextInvalidError extends VoiceError {
  constructor(message = 'Tool context is invalid or incomplete') {
    super(400, 'VOICE_TOOL_CONTEXT_INVALID', message);
    this.name = 'VoiceToolContextInvalidError';
  }
}

// ── Generic ───────────────────────────────────────────────────────────────────

export class VoiceInternalError extends VoiceError {
  constructor(message = 'Internal voice processing error', details?: unknown) {
    super(500, 'VOICE_INTERNAL_ERROR', message, details);
    this.name = 'VoiceInternalError';
  }
}
