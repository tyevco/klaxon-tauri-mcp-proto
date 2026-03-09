import React from "react";
import ReactMarkdown from "react-markdown";
import { FormField } from "@klaxon/protocol";

export interface FormFieldProps {
  field: FormField;
  value: any;
  error?: string;
  onChange: (v: any) => void;
}

function btnStyle(): React.CSSProperties {
  return {
    background: "transparent",
    border: "1px solid var(--border)",
    color: "var(--text)",
    borderRadius: 10,
    padding: "6px 10px",
    fontSize: 12,
  };
}

function primaryBtnStyle(): React.CSSProperties {
  return {
    background: "rgba(90, 169, 255, 0.18)",
    border: "1px solid rgba(90, 169, 255, 0.5)",
    color: "var(--text)",
    borderRadius: 10,
    padding: "6px 10px",
    fontSize: 12,
  };
}

function DiffView({ diff }: { diff: string }) {
  return (
    <pre style={{ margin: 0, fontSize: 11, whiteSpace: "pre-wrap", opacity: 0.9 }}>
      {diff.split("\n").map((line, i) => {
        const color = line.startsWith("+")
          ? "var(--ok)"
          : line.startsWith("-")
            ? "var(--danger)"
            : line.startsWith("@")
              ? "var(--info)"
              : undefined;
        return (
          <span key={i} style={{ color, display: "block" }}>
            {line}
          </span>
        );
      })}
    </pre>
  );
}

export function FormFieldRenderer({ field, value, error, onChange }: FormFieldProps) {
  const label = (
    <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
      <div style={{ fontSize: 12, fontWeight: 650, opacity: 0.95 }}>
        {"label" in field && field.label ? (
          <>
            {field.label}
            {"required" in field && field.required ? (
              <span style={{ color: "var(--warn)" }}> *</span>
            ) : null}
          </>
        ) : null}
      </div>
      {error ? <div style={{ fontSize: 11, color: "var(--danger)" }}>{error}</div> : null}
    </div>
  );

  const commonInput: React.CSSProperties = {
    width: "100%",
    borderRadius: 10,
    border: "1px solid var(--border)",
    background: "rgba(0,0,0,0.18)",
    color: "var(--text)",
    padding: "8px 10px",
    fontSize: 13,
    boxSizing: "border-box",
  };

  switch (field.type) {
    case "text":
      return (
        <div>
          {label}
          <input
            style={commonInput}
            value={value ?? ""}
            placeholder={field.placeholder ?? ""}
            onChange={e => onChange(e.target.value)}
          />
        </div>
      );
    case "textarea":
      return (
        <div>
          {label}
          <textarea
            style={{ ...commonInput, minHeight: 72 }}
            value={value ?? ""}
            placeholder={field.placeholder ?? ""}
            onChange={e => onChange(e.target.value)}
          />
        </div>
      );
    case "number":
      return (
        <div>
          {label}
          <input
            style={commonInput}
            type="number"
            value={value ?? ""}
            onChange={e => onChange(e.target.value)}
          />
        </div>
      );
    case "select":
      return (
        <div>
          {label}
          <select style={commonInput} value={value ?? ""} onChange={e => onChange(e.target.value)}>
            <option value="" disabled>
              Select…
            </option>
            {field.options?.map(o => (
              <option key={o.value} value={o.value}>
                {o.label ?? o.value}
              </option>
            ))}
          </select>
        </div>
      );
    case "multiselect":
      return (
        <div>
          {label}
          <select
            style={commonInput}
            multiple
            value={Array.isArray(value) ? value : []}
            onChange={e => {
              const selected = Array.from(e.target.selectedOptions).map(o => o.value);
              onChange(selected);
            }}
          >
            {field.options?.map(o => (
              <option key={o.value} value={o.value}>
                {o.label ?? o.value}
              </option>
            ))}
          </select>
        </div>
      );
    case "radio":
      return (
        <div>
          {label}
          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 6 }}>
            {field.options?.map(o => (
              <label
                key={o.value}
                style={{
                  display: "flex",
                  gap: 8,
                  alignItems: "center",
                  fontSize: 13,
                  opacity: 0.9,
                }}
              >
                <input
                  type="radio"
                  name={field.id}
                  checked={value === o.value}
                  onChange={() => onChange(o.value)}
                />
                {o.label ?? o.value}
              </label>
            ))}
          </div>
        </div>
      );
    case "checkbox":
      return (
        <div>
          {label}
          <label
            style={{
              display: "flex",
              gap: 8,
              alignItems: "center",
              marginTop: 6,
              fontSize: 13,
              opacity: 0.9,
            }}
          >
            <input type="checkbox" checked={!!value} onChange={e => onChange(e.target.checked)} />
            {field.help ?? "Enabled"}
          </label>
        </div>
      );
    case "toggle":
      return (
        <div>
          {label}
          <label
            style={{
              display: "flex",
              gap: 8,
              alignItems: "center",
              marginTop: 6,
              fontSize: 13,
              opacity: 0.9,
            }}
          >
            <input type="checkbox" checked={!!value} onChange={e => onChange(e.target.checked)} />
            {field.help ?? (value ? "On" : "Off")}
          </label>
        </div>
      );
    case "datetime":
      return (
        <div>
          {label}
          <input
            style={commonInput}
            type="datetime-local"
            value={value ?? ""}
            onChange={e => onChange(e.target.value)}
          />
        </div>
      );
    case "issuepicker":
      return (
        <div>
          {label}
          <input
            style={commonInput}
            list={`${field.id}-issues`}
            value={value ?? ""}
            placeholder={field.placeholder ?? "PROJ-123"}
            onChange={e => onChange(e.target.value)}
          />
          <datalist id={`${field.id}-issues`}>
            {(field.suggestions ?? []).map(s => (
              <option key={s} value={s} />
            ))}
          </datalist>
          {field.help ? (
            <div style={{ fontSize: 12, opacity: 0.65, marginTop: 6 }}>{field.help}</div>
          ) : null}
        </div>
      );
    case "diffapproval":
      return (
        <div>
          {label}
          <div
            style={{
              marginTop: 6,
              border: "1px solid var(--border)",
              borderRadius: 10,
              padding: 8,
              background: "rgba(0,0,0,0.18)",
            }}
          >
            <DiffView diff={field.diff} />
            <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
              <button style={primaryBtnStyle()} onClick={() => onChange("approve")}>
                {field.approve_label ?? "Approve"}
              </button>
              <button style={btnStyle()} onClick={() => onChange("reject")}>
                {field.reject_label ?? "Reject"}
              </button>
            </div>
          </div>
        </div>
      );
    case "rating": {
      const min = field.min ?? 1;
      const max = field.max ?? 5;
      const current = typeof value === "number" ? value : 0;
      return (
        <div>
          {label}
          <div style={{ display: "flex", gap: 4, marginTop: 6 }}>
            {Array.from({ length: max }, (_, i) => i + 1).map(n => (
              <span
                key={n}
                onClick={() => onChange(n)}
                style={{
                  fontSize: 22,
                  cursor: "pointer",
                  color: n <= current ? "var(--warn)" : "var(--border)",
                  opacity: n < min ? 0.3 : 1,
                  userSelect: "none",
                }}
              >
                {n <= current ? "★" : "☆"}
              </span>
            ))}
          </div>
        </div>
      );
    }
    case "slider": {
      const min = field.min ?? 0;
      const max = field.max ?? 100;
      const step = field.step ?? 1;
      const current = typeof value === "number" ? value : (field.default ?? min);
      return (
        <div>
          {label}
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 6 }}>
            <input
              type="range"
              min={min}
              max={max}
              step={step}
              value={current}
              style={{ flex: 1 }}
              onChange={e => onChange(Number(e.target.value))}
            />
            <span style={{ fontSize: 13, minWidth: 32, textAlign: "right", opacity: 0.9 }}>
              {current}
            </span>
          </div>
        </div>
      );
    }
    case "markdown":
      return (
        <div className="klaxon-md" style={{ fontSize: 13, opacity: 0.85 }}>
          <ReactMarkdown>{field.content}</ReactMarkdown>
        </div>
      );
    default:
      return (
        <div>
          {label}
          <div style={{ fontSize: 12, opacity: 0.6, marginTop: 6 }}>
            Unsupported field type: {(field as any).type}
          </div>
        </div>
      );
  }
}

export function validateField(field: FormField, value: any): string | null {
  if (field.type === "markdown") return null;
  if (
    "required" in field &&
    field.required &&
    (value === undefined ||
      value === null ||
      value === "" ||
      (Array.isArray(value) && value.length === 0))
  ) {
    return "Required";
  }
  if (field.type === "text" || field.type === "textarea") {
    if (typeof value === "string") {
      if (field.min_len !== undefined && value.length < field.min_len)
        return `Min length ${field.min_len}`;
      if (field.max_len !== undefined && value.length > field.max_len)
        return `Max length ${field.max_len}`;
      if (field.pattern) {
        try {
          if (!new RegExp(field.pattern).test(value)) return "Does not match pattern";
        } catch {
          /* ignore */
        }
      }
    }
  }
  if (field.type === "number") {
    const n = Number(value);
    if (!Number.isFinite(n)) return "Must be a number";
    if (field.min !== undefined && n < field.min) return `Min ${field.min}`;
    if (field.max !== undefined && n > field.max) return `Max ${field.max}`;
  }
  return null;
}
