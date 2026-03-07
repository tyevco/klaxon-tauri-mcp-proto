import { z } from "zod";

/**
 * Protocol types shared between UI and backend.
 * Keep this stable; version it once agents rely on it.
 */

export const FormOptionSchema = z.object({
  label: z.string(),
  value: z.string(),
});

export type FormOption = z.infer<typeof FormOptionSchema>;

export const FormFieldSchema = z.discriminatedUnion("type", [
  z.object({
    id: z.string(),
    type: z.literal("text"),
    label: z.string(),
    required: z.boolean().optional(),
    placeholder: z.string().optional(),
    help: z.string().optional(),
    min_len: z.number().int().nonnegative().optional(),
    max_len: z.number().int().nonnegative().optional(),
    pattern: z.string().optional(),
  }),
  z.object({
    id: z.string(),
    type: z.literal("textarea"),
    label: z.string(),
    required: z.boolean().optional(),
    placeholder: z.string().optional(),
    help: z.string().optional(),
    min_len: z.number().int().nonnegative().optional(),
    max_len: z.number().int().nonnegative().optional(),
    pattern: z.string().optional(),
  }),
  z.object({
    id: z.string(),
    type: z.literal("number"),
    label: z.string(),
    required: z.boolean().optional(),
    help: z.string().optional(),
    min: z.number().optional(),
    max: z.number().optional(),
  }),
  z.object({
    id: z.string(),
    type: z.literal("select"),
    label: z.string(),
    required: z.boolean().optional(),
    help: z.string().optional(),
    options: z.array(FormOptionSchema).default([]),
  }),
  z.object({
    id: z.string(),
    type: z.literal("multiselect"),
    label: z.string(),
    required: z.boolean().optional(),
    help: z.string().optional(),
    options: z.array(FormOptionSchema).default([]),
  }),
  z.object({
    id: z.string(),
    type: z.literal("radio"),
    label: z.string(),
    required: z.boolean().optional(),
    help: z.string().optional(),
    options: z.array(FormOptionSchema).default([]),
  }),
  z.object({
    id: z.string(),
    type: z.literal("checkbox"),
    label: z.string(),
    required: z.boolean().optional(),
    help: z.string().optional(),
  }),
  z.object({
    id: z.string(),
    type: z.literal("toggle"),
    label: z.string(),
    required: z.boolean().optional(),
    help: z.string().optional(),
  }),
  z.object({
    id: z.string(),
    type: z.literal("datetime"),
    label: z.string(),
    required: z.boolean().optional(),
    help: z.string().optional(),
  }),
  z.object({
    id: z.string(),
    type: z.literal("issuepicker"),
    label: z.string(),
    required: z.boolean().optional(),
    placeholder: z.string().optional(),
    help: z.string().optional(),
    suggestions: z.array(z.string()).optional(),
  }),
  z.object({
    id: z.string(),
    type: z.literal("diffapproval"),
    label: z.string(),
    required: z.boolean().optional(),
    summary: z.string().optional(),
    diff: z.string().optional(),
  }),
]);

export type FormField = z.infer<typeof FormFieldSchema>;

export const FormSchemaSchema = z.object({
  id: z.string(),
  title: z.string().optional(),
  description: z.string().optional(),
  fields: z.array(FormFieldSchema).default([]),
  submitLabel: z.string().optional(),
  cancelLabel: z.string().optional(),
});

export type FormSchema = z.infer<typeof FormSchemaSchema>;

export const KlaxonActionSchema = z.discriminatedUnion("kind", [
  z.object({
    id: z.string(),
    kind: z.literal("ack"),
    label: z.string(),
  }),
  z.object({
    id: z.string(),
    kind: z.literal("open_url"),
    label: z.string(),
    url: z.string(),
  }),
  z.object({
    id: z.string(),
    kind: z.literal("run_tool"),
    label: z.string(),
    tool: z.string(),
    arguments: z.record(z.any()).optional(),
  }),
]);

export type KlaxonAction = z.infer<typeof KlaxonActionSchema>;

export const KlaxonItemSchema = z.object({
  id: z.string(),
  level: z.enum(["info", "warning", "error", "success"]).default("info"),
  title: z.string(),
  message: z.string().optional(),
  created_at: z.string(),
  ttl_ms: z.number().int().positive().optional(),
  status: z.enum(["open", "answered", "dismissed", "expired"]).default("open"),
  form: FormSchemaSchema.optional(),
  actions: z.array(KlaxonActionSchema).optional(),
});

export type KlaxonItem = z.infer<typeof KlaxonItemSchema>;

export const KlaxonAnswerSchema = z.object({
  item_id: z.string(),
  values: z.record(z.any()),
  answered_at: z.string().optional(),
});

export type KlaxonAnswer = z.infer<typeof KlaxonAnswerSchema>;

// --- Timer ---

export const TimerEntrySchema = z.object({
  issue_id: z.string(),
  start: z.string(),
  end: z.string(),
  seconds: z.number(),
  note: z.string().optional(),
});

export type TimerEntry = z.infer<typeof TimerEntrySchema>;

export const IssueSummarySchema = z.object({
  issue_id: z.string(),
  seconds: z.number(),
  active_since: z.string().optional(),
});

export type IssueSummary = z.infer<typeof IssueSummarySchema>;

export const TimerStateSchema = z.object({
  active: z.object({ issue_id: z.string(), start: z.string() }).nullable(),
  today: z.array(IssueSummarySchema),
});

export type TimerState = z.infer<typeof TimerStateSchema>;

// --- Tokens ---

export const TokenDeltaSchema = z.object({
  model: z.string(),
  input_tokens: z.number(),
  output_tokens: z.number(),
  cost_usd: z.number().optional(),
  source: z.string().optional(),
});

export type TokenDelta = z.infer<typeof TokenDeltaSchema>;

export const ModelTotalsSchema = z.object({
  model: z.string(),
  input_tokens: z.number(),
  output_tokens: z.number(),
  cost_usd: z.number(),
});

export type ModelTotals = z.infer<typeof ModelTotalsSchema>;
