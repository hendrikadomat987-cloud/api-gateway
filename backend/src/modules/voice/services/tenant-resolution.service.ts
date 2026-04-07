// src/modules/voice/services/tenant-resolution.service.ts
import { findNumberByPhoneNumber } from '../repositories/voice-numbers.repository.js';
import { findAgentByProviderAgentId, findAgentById } from '../repositories/voice-agents.repository.js';
import { VoiceTenantNotResolvedError } from '../../../errors/voice-errors.js';
import { normalizeToE164 } from '../utils/phone-number.js';
import { serviceLogger } from '../../../logger/index.js';
import type { VoiceAgent } from '../../../types/voice.js';

const log = serviceLogger.child({ name: 'voice.tenant-resolution' });

/**
 * Resolves the tenant from a VAPI webhook call.
 *
 * Resolution order (strict — tenant is NEVER trusted from payload/headers):
 *   1. called number (the number that was dialled) via voice_numbers.phone_number
 *   2. provider_agent_id via voice_agents.provider_agent_id
 *   3. conflict check: if both resolve to different tenants → hard failure
 *   4. hard failure if neither resolves
 *
 * Returns the resolved VoiceAgent which carries the tenant_id.
 */
export async function resolveTenantFromCall(opts: {
  calledNumber?: string;
  providerAgentId?: string;
}): Promise<VoiceAgent> {
  const { calledNumber, providerAgentId } = opts;

  log.debug({ calledNumber, providerAgentId }, 'resolving tenant from call');

  // Step 1: Resolve via called number
  let agentByNumber: VoiceAgent | undefined;
  if (calledNumber) {
    const normalized = normalizeToE164(calledNumber);
    const voiceNumber = await findNumberByPhoneNumber(normalized);
    if (voiceNumber?.voice_agent_id) {
      const agent = await findAgentById(voiceNumber.voice_agent_id);
      if (agent?.status === 'active') {
        agentByNumber = agent;
        log.debug({ calledNumber: normalized, agentId: agent.id, tenantId: agent.tenant_id }, 'resolved via called number');
      } else {
        log.debug({ calledNumber: normalized, voiceAgentId: voiceNumber.voice_agent_id, agentStatus: agent?.status }, 'called number found but agent inactive or missing');
      }
    } else {
      log.debug({ calledNumber: normalized }, 'no voice number or agent found for called number');
    }
  }

  // Step 2: Resolve via provider agent ID
  let agentByProviderId: VoiceAgent | undefined;
  if (providerAgentId) {
    const agent = await findAgentByProviderAgentId(providerAgentId);
    if (agent?.status === 'active') {
      agentByProviderId = agent;
      log.debug({ providerAgentId, agentId: agent.id, tenantId: agent.tenant_id }, 'resolved via provider agent id');
    } else {
      log.debug({ providerAgentId, agentStatus: agent?.status }, 'provider agent id found but agent inactive or missing');
    }
  }

  // Step 3: Conflict check — both resolved but point to different tenants
  if (agentByNumber && agentByProviderId) {
    if (agentByNumber.tenant_id !== agentByProviderId.tenant_id) {
      log.warn(
        { calledNumber, providerAgentId, tenantByNumber: agentByNumber.tenant_id, tenantByProviderId: agentByProviderId.tenant_id },
        'tenant conflict: called number and provider agent id point to different tenants',
      );
      throw new VoiceTenantNotResolvedError(
        'Cannot resolve tenant: called number and provider agent id point to different tenants',
      );
    }
    return agentByNumber;
  }

  // Step 4: Return whichever resolved, or hard failure
  if (agentByNumber) return agentByNumber;
  if (agentByProviderId) return agentByProviderId;

  log.warn(
    { calledNumber, providerAgentId },
    'tenant resolution failed: no active agent matched called number or provider agent id',
  );
  throw new VoiceTenantNotResolvedError(
    'Cannot resolve tenant: no active agent matched the called number or provider agent id',
  );
}
