// src/modules/voice/orchestration/resolve-track.ts
import { VoiceTrackNotResolvedError } from '../../../errors/voice-errors.js';
import type { VoiceTrack } from '../../../types/voice.js';

const SUPPORTED_TRACKS: ReadonlySet<string> = new Set<VoiceTrack>(['booking', 'restaurant']);

/**
 * Validates that the track carried on the resolved VoiceAgent is a supported V1 track.
 * The track is set at agent configuration time — never derived from inbound payload.
 */
export function assertSupportedTrack(track: string): asserts track is VoiceTrack {
  if (!SUPPORTED_TRACKS.has(track)) {
    throw new VoiceTrackNotResolvedError(track);
  }
}

export function resolveTrack(rawTrack: string): VoiceTrack {
  assertSupportedTrack(rawTrack);
  return rawTrack;
}
