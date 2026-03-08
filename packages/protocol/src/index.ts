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
  z.object({
    type: z.literal("rating"),
    id: z.string(),
    label: z.string(),
    required: z.boolean().optional(),
    min: z.number().int().default(1),
    max: z.number().int().default(5),
    default: z.number().int().optional(),
  }),
  z.object({
    type: z.literal("slider"),
    id: z.string(),
    label: z.string(),
    required: z.boolean().optional(),
    min: z.number(),
    max: z.number(),
    step: z.number().default(1),
    default: z.number().optional(),
  }),
  z.object({
    type: z.literal("markdown"),
    id: z.string(),
    label: z.string().optional().default(""),
    content: z.string(),
  }),
]);

export type FormField = z.infer<typeof FormFieldSchema>;

export const FormBranchSchema = z.object({ value: z.string(), page_id: z.string() });

export const FormPageNextSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("end") }),
  z.object({ kind: z.literal("fixed"), page_id: z.string() }),
  z.object({
    kind: z.literal("conditional"),
    field_id: z.string(),
    branches: z.array(FormBranchSchema),
    default: z.string().optional(),
  }),
]);

export const FormPageSchema = z.object({
  id: z.string(),
  title: z.string().optional(),
  fields: z.array(FormFieldSchema).default([]),
  next: FormPageNextSchema.optional(),
});

export type FormPage = z.infer<typeof FormPageSchema>;
export type FormPageNext = z.infer<typeof FormPageNextSchema>;

export const FormSchemaSchema = z.object({
  id: z.string(),
  title: z.string().optional(),
  description: z.string().optional(),
  fields: z.array(FormFieldSchema).default([]),
  pages: z.array(FormPageSchema).default([]),
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

export const DayTotalsSchema = z.object({
  date: z.string(),
  cost_usd: z.number(),
  input_tokens: z.number(),
  output_tokens: z.number(),
});

export type DayTotals = z.infer<typeof DayTotalsSchema>;

// --- Timer report ---

export const WeekEntrySchema = z.object({
  issue_id: z.string(),
  date: z.string(),
  seconds: z.number(),
});

export type WeekEntry = z.infer<typeof WeekEntrySchema>;

// --- Agent connections ---

export const AgentInfoSchema = z.object({
  client_id: z.string(),
  last_seen: z.string(),
  last_tool: z.string().optional(),
  calls_today: z.number(),
});

export type AgentInfo = z.infer<typeof AgentInfoSchema>;

// --- Cost allocation ---

export const SourceModelTotalsSchema = z.object({
  source: z.string(),
  model: z.string(),
  input_tokens: z.number(),
  output_tokens: z.number(),
  cost_usd: z.number(),
});

export type SourceModelTotals = z.infer<typeof SourceModelTotalsSchema>;

// --- Scratchpad ---

export const ScratchpadEntrySchema = z.object({
  id: z.number(),
  content: z.string(),
  author: z.string(),
  created_at: z.string(),
});

export type ScratchpadEntry = z.infer<typeof ScratchpadEntrySchema>;

// --- Checkpoints ---

export const CheckpointSchema = z.object({
  id: z.number(),
  label: z.string(),
  detail: z.string().optional(),
  progress_pct: z.number().optional(),
  session_tag: z.string().optional(),
  created_at: z.string(),
});

export type Checkpoint = z.infer<typeof CheckpointSchema>;

// --- Log tail ---

export const LogLineSchema = z.object({
  line: z.string(),
  stream: z.string(),
  ts: z.string(),
});

export type LogLine = z.infer<typeof LogLineSchema>;

// --- Tool call log ---

export const ToolCallEntrySchema = z.object({
  tool: z.string(),
  args_summary: z.string(),
  duration_ms: z.number(),
  ok: z.boolean(),
  error: z.string().optional(),
  client_id: z.string(),
  called_at: z.string(),
});

export type ToolCallEntry = z.infer<typeof ToolCallEntrySchema>;

// --- Alert rules ---

export const AlertRuleSchema = z.object({
  id: z.number(),
  kind: z.string(),
  threshold: z.number(),
  level: z.string(),
  message: z.string(),
  enabled: z.boolean(),
  last_fired_at: z.string().optional(),
});

export type AlertRule = z.infer<typeof AlertRuleSchema>;

// --- Work queue ---

export const WorkItemSchema = z.object({
  id: z.number(),
  title: z.string(),
  detail: z.string().optional(),
  status: z.string(),
  priority: z.number(),
  agent_id: z.string().optional(),
  created_at: z.string(),
  updated_at: z.string(),
});

export type WorkItem = z.infer<typeof WorkItemSchema>;

// --- Session summary ---

export const SessionSummarySchema = z.object({
  open_count: z.number(),
  active_timers: z.array(z.object({ issue_id: z.string(), start: z.string() })),
  today_cost: z.number(),
  last_decision: z.string().optional(),
});

export type SessionSummary = z.infer<typeof SessionSummarySchema>;
