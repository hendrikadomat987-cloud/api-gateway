// src/modules/voice/validators/vapi-webhook.schema.ts
import { z } from 'zod';

const VapiCallSchema = z.object({
  id: z.string(),
  orgId: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
  type: z.string().optional(),
  status: z.string().optional(),
  assistantId: z.string().optional(),
  phoneNumberId: z.string().optional(),
  customer: z
    .object({
      number: z.string().optional(),
      name: z.string().optional(),
    })
    .optional(),
  phoneNumber: z
    .object({
      number: z.string().optional(),
    })
    .optional(),
});

const VapiToolCallFunctionSchema = z.object({
  name: z.string(),
  arguments: z.record(z.unknown()),
});

const VapiToolCallSchema = z.object({
  id: z.string(),
  type: z.literal('function'),
  function: VapiToolCallFunctionSchema,
});

const VapiBaseMessageSchema = z.object({
  type: z.string(),
  call: VapiCallSchema,
  timestamp: z.string().optional(),
});

const VapiToolCallsMessageSchema = VapiBaseMessageSchema.extend({
  type: z.literal('tool-calls'),
  toolCallList: z.array(VapiToolCallSchema),
});

const VapiFunctionCallMessageSchema = VapiBaseMessageSchema.extend({
  type: z.literal('function-call'),
  functionCall: z.object({
    name: z.string(),
    parameters: z.record(z.unknown()),
  }),
});

const VapiEndOfCallReportSchema = VapiBaseMessageSchema.extend({
  type: z.literal('end-of-call-report'),
  endedReason: z.string().optional(),
  summary: z.string().optional(),
  transcript: z.string().optional(),
  durationSeconds: z.number().optional(),
  cost: z.number().optional(),
});

const VapiStatusUpdateSchema = VapiBaseMessageSchema.extend({
  type: z.literal('status-update'),
  status: z.string().optional(),
});

export const VapiWebhookMessageSchema = z.discriminatedUnion('type', [
  VapiToolCallsMessageSchema,
  VapiFunctionCallMessageSchema,
  VapiEndOfCallReportSchema,
  VapiStatusUpdateSchema,
]).or(VapiBaseMessageSchema);

export const VapiWebhookPayloadSchema = z.object({
  message: VapiBaseMessageSchema.and(z.record(z.unknown())),
});

export type ValidatedVapiWebhookPayload = z.infer<typeof VapiWebhookPayloadSchema>;
