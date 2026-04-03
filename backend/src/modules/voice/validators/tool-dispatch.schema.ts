// src/modules/voice/validators/tool-dispatch.schema.ts
import { z } from 'zod';

export const ToolInputSchema = z.object({
  name: z.string().min(1),
  arguments: z.record(z.unknown()),
});

export const ToolDispatchRequestSchema = z.object({
  callId: z.string().uuid(),
  sessionId: z.string().uuid().optional(),
  tools: z.array(ToolInputSchema).min(1),
});

export type ValidatedToolDispatchRequest = z.infer<typeof ToolDispatchRequestSchema>;
