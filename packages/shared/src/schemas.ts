import { z } from "zod";

export const ProviderIdSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9][a-z0-9._-]*$/, "invalid provider id");

export const ModelIdSchema = z
  .string()
  .min(1)
  .max(128)
  .refine((v) => !v.includes(":"), "model id must not contain a colon");

export const ModelRefSchema = z
  .object({
    provider_id: ProviderIdSchema,
    model_id: ModelIdSchema,
  })
  .strict();
export type ModelRef = z.infer<typeof ModelRefSchema>;

export const ManualProvidersSchema = z
  .object({
    fcm: ModelRefSchema.nullable(),
    ptm: ModelRefSchema,
    vcm: ModelRefSchema,
  })
  .strict();
export type ManualProviders = z.infer<typeof ManualProvidersSchema>;

export const MergeStyleSchema = z.enum(["hybrid", "always_patch", "always_replace"]);
export type MergeStyle = z.infer<typeof MergeStyleSchema>;

export const PriceEntrySchema = z
  .object({
    input_per_1m: z.number().nonnegative(),
    output_per_1m: z.number().nonnegative(),
  })
  .strict();
export type PriceEntry = z.infer<typeof PriceEntrySchema>;

export const PriceTableOverrideSchema = z
  .record(z.string(), PriceEntrySchema)
  .superRefine((obj, ctx) => {
    for (const key of Object.keys(obj)) {
      if (key.length > 256) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `key too long: ${key}` });
        continue;
      }
      const first = key.indexOf(":");
      const last = key.lastIndexOf(":");
      if (first === -1 || first !== last) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `key must contain exactly one colon: ${key}`,
        });
        continue;
      }
      const providerPart = key.slice(0, first);
      const modelPart = key.slice(first + 1);
      if (!ProviderIdSchema.safeParse(providerPart).success) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `invalid provider segment in key: ${key}`,
        });
      }
      if (!ModelIdSchema.safeParse(modelPart).success) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `invalid model segment in key: ${key}`,
        });
      }
    }
  });
export type PriceTableOverride = z.infer<typeof PriceTableOverrideSchema>;

export const RouterModeSchema = z.literal("manual");

export const MessageSchema = z
  .object({
    role: z.enum(["system", "user", "assistant"]),
    content: z.string().min(1).max(64_000),
  })
  .strict();
export type Message = z.infer<typeof MessageSchema>;

export const ChatStreamRequestSchema = z
  .object({
    messages: z.array(MessageSchema).min(1).max(64),
    manual_providers: ManualProvidersSchema,
    merge_style: MergeStyleSchema.default("hybrid"),
    enable_fast_draft: z.boolean().default(true),
    router_mode: RouterModeSchema.default("manual"),
    price_table_override: PriceTableOverrideSchema.optional(),
    ephemeral_keys: z.record(ProviderIdSchema, z.string().min(1)).optional(),
  })
  .strict();
export type ChatStreamRequest = z.infer<typeof ChatStreamRequestSchema>;

export const PriorityModeSchema = z.enum(["latency", "reliability", "budget", "balanced"]);
export type PriorityMode = z.infer<typeof PriorityModeSchema>;

export const ProviderPrefEntrySchema = z
  .object({
    provider_id: ProviderIdSchema,
    enabled: z.boolean(),
    selected_model: ModelIdSchema.nullable(),
    priority_mode: PriorityModeSchema,
    cost_weight: z.number().int().min(0).max(10),
    quota_hint_daily: z.number().int().nonnegative().optional(),
  })
  .strict();
export type ProviderPrefEntry = z.infer<typeof ProviderPrefEntrySchema>;

export const ProviderPrefsPutSchema = z
  .object({
    prefs: z.array(ProviderPrefEntrySchema).max(64),
  })
  .strict();
export type ProviderPrefsPut = z.infer<typeof ProviderPrefsPutSchema>;

export const RoleAssignmentPutSchema = ModelRefSchema.nullable();
export type RoleAssignmentPut = z.infer<typeof RoleAssignmentPutSchema>;
