// src/modules/voice/validators/vapi-webhook.schema.ts
import { z } from 'zod';

const VapiCallSchema = z.object({
  id: z.string(),
  orgId: z.string().optional(),
  // createdAt / updatedAt are optional: Vapi omits them on some event types
  // (e.g. status-update mid-call) or early-exit SIP events
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
  type: z.string().optional(),
  status: z.string().optional(),
  assistantId: z.string().optional(),
  phoneNumberId: z.string().optional(),
  // Real Vapi end-of-call-report payloads send these as explicit null when the
  // call ended before the fields were populated (e.g. SIP-completed calls).
  // .nullable() is needed in addition to .optional() — Zod treats null and
  // undefined as distinct; .optional() alone only allows undefined/absent.
  customer: z
    .object({
      number: z.string().optional(),
      name: z.string().optional(),
      sipUri: z.string().optional(),
    })
    .nullable()
    .optional(),
  phoneNumber: z
    .object({
      number: z.string().optional(),
    })
    .nullable()
    .optional(),
});

const VapiToolCallFunctionSchema = z.object({
  name: z.string(),
  // Real Vapi payloads occasionally serialize arguments as a JSON string rather
  // than an inline object — accept both; callers must parse the string form.
  arguments: z.union([z.record(z.unknown()), z.string()]),
});

const VapiToolCallSchema = z.object({
  id: z.string(),
  type: z.literal('function'),
  function: VapiToolCallFunctionSchema,
});

const VapiBaseMessageSchema = z.object({
  type: z.string(),
  call: VapiCallSchema,
  // Vapi sends timestamp as a Unix-millisecond number on real payloads; some
  // synthetic/older events use an ISO-8601 string — accept both.
  timestamp: z.union([z.string(), z.number()]).optional(),
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
