import { describe, it, expect } from "vitest";
import {
  FormFieldSchema,
  KlaxonItemSchema,
  KlaxonActionSchema,
  TimerEntrySchema,
  IssueSummarySchema,
  ModelTotalsSchema,
  TokenDeltaSchema,
} from "../index";

// ---------------------------------------------------------------------------
// FormFieldSchema
// ---------------------------------------------------------------------------

describe("FormFieldSchema", () => {
  it("parses minimal text field", () => {
    const result = FormFieldSchema.parse({ id: "q1", type: "text", label: "Name" });
    expect(result.id).toBe("q1");
    expect(result.type).toBe("text");
  });

  it("parses text field with all optional fields", () => {
    const result = FormFieldSchema.parse({
      id: "q1",
      type: "text",
      label: "Name",
      required: true,
      placeholder: "Enter name",
      min_len: 2,
      max_len: 50,
    });
    expect(result.type).toBe("text");
    if (result.type === "text") {
      expect(result.required).toBe(true);
      expect(result.min_len).toBe(2);
      expect(result.max_len).toBe(50);
    }
  });

  it("rejects text field missing id", () => {
    expect(() => FormFieldSchema.parse({ type: "text", label: "Name" })).toThrow();
  });

  it("parses select field; defaults options to [] when omitted", () => {
    const result = FormFieldSchema.parse({ id: "q1", type: "select", label: "Pick" });
    if (result.type === "select") {
      expect(result.options).toEqual([]);
    }
  });

  it("parses diffapproval field", () => {
    const result = FormFieldSchema.parse({ id: "d1", type: "diffapproval", label: "Review diff" });
    expect(result.type).toBe("diffapproval");
  });

  it("rejects unknown type", () => {
    expect(() => FormFieldSchema.parse({ id: "x", type: "slider", label: "x" })).toThrow();
  });

  const allTypes = [
    { id: "f1", type: "text", label: "Text" },
    { id: "f2", type: "textarea", label: "Textarea" },
    { id: "f3", type: "number", label: "Number" },
    { id: "f4", type: "select", label: "Select" },
    { id: "f5", type: "multiselect", label: "Multi" },
    { id: "f6", type: "radio", label: "Radio" },
    { id: "f7", type: "checkbox", label: "Check" },
    { id: "f8", type: "toggle", label: "Toggle" },
    { id: "f9", type: "datetime", label: "Date" },
    { id: "f10", type: "issuepicker", label: "Issue" },
    { id: "f11", type: "diffapproval", label: "Diff" },
  ] as const;

  it.each(allTypes)("all 11 field types parse without error: $type", (field) => {
    expect(() => FormFieldSchema.parse(field)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// KlaxonItemSchema
// ---------------------------------------------------------------------------

describe("KlaxonItemSchema", () => {
  const minimalItem = {
    id: "550e8400-e29b-41d4-a716-446655440000",
    title: "Hello",
    created_at: new Date().toISOString(),
  };

  it("parses minimal item; defaults level==info, status==open", () => {
    const result = KlaxonItemSchema.parse(minimalItem);
    expect(result.level).toBe("info");
    expect(result.status).toBe("open");
  });

  it("rejects item missing id", () => {
    const { id: _id, ...noId } = minimalItem;
    expect(() => KlaxonItemSchema.parse(noId)).toThrow();
  });

  it("rejects invalid level 'critical'", () => {
    expect(() => KlaxonItemSchema.parse({ ...minimalItem, level: "critical" })).toThrow();
  });

  it("rejects invalid status 'acknowledged'", () => {
    expect(() => KlaxonItemSchema.parse({ ...minimalItem, status: "acknowledged" })).toThrow();
  });

  it.each(["info", "warning", "error", "success"] as const)(
    "accepts all 4 valid level values: %s",
    (level) => {
      expect(() => KlaxonItemSchema.parse({ ...minimalItem, level })).not.toThrow();
    },
  );
});

// ---------------------------------------------------------------------------
// KlaxonActionSchema
// ---------------------------------------------------------------------------

describe("KlaxonActionSchema", () => {
  it("parses ack action", () => {
    const result = KlaxonActionSchema.parse({ id: "a1", kind: "ack", label: "OK" });
    expect(result.kind).toBe("ack");
  });

  it("parses open_url action", () => {
    const result = KlaxonActionSchema.parse({ id: "a2", kind: "open_url", label: "Visit", url: "https://example.com" });
    expect(result.kind).toBe("open_url");
  });

  it("parses run_tool action with arguments", () => {
    const result = KlaxonActionSchema.parse({
      id: "a3",
      kind: "run_tool",
      label: "Run",
      tool: "my.tool",
      arguments: { foo: "bar" },
    });
    expect(result.kind).toBe("run_tool");
  });

  it("rejects unknown kind", () => {
    expect(() => KlaxonActionSchema.parse({ id: "a4", kind: "explode", label: "x" })).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Timer / Token schemas
// ---------------------------------------------------------------------------

describe("TimerEntrySchema", () => {
  it("parses valid TimerEntrySchema", () => {
    const result = TimerEntrySchema.parse({
      issue_id: "PROJ-1",
      start: new Date().toISOString(),
      end: new Date().toISOString(),
      seconds: 120,
    });
    expect(result.issue_id).toBe("PROJ-1");
    expect(result.seconds).toBe(120);
  });

  it("rejects TimerEntrySchema missing end", () => {
    expect(() =>
      TimerEntrySchema.parse({ issue_id: "PROJ-1", start: new Date().toISOString(), seconds: 0 }),
    ).toThrow();
  });
});

describe("IssueSummarySchema", () => {
  it("parses valid IssueSummarySchema", () => {
    const result = IssueSummarySchema.parse({ issue_id: "PROJ-2", seconds: 300 });
    expect(result.issue_id).toBe("PROJ-2");
  });
});

describe("ModelTotalsSchema", () => {
  it("parses valid ModelTotalsSchema", () => {
    const result = ModelTotalsSchema.parse({
      model: "claude-3-5-sonnet",
      input_tokens: 100,
      output_tokens: 50,
      cost_usd: 0.01,
    });
    expect(result.model).toBe("claude-3-5-sonnet");
  });
});

describe("TokenDeltaSchema", () => {
  it("parses valid TokenDeltaSchema with optional fields omitted", () => {
    const result = TokenDeltaSchema.parse({
      model: "claude-sonnet-4-6",
      input_tokens: 200,
      output_tokens: 80,
    });
    expect(result.model).toBe("claude-sonnet-4-6");
    expect(result.cost_usd).toBeUndefined();
    expect(result.source).toBeUndefined();
  });
});
