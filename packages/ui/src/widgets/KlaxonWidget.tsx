import React, { useEffect, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { KlaxonItem, KlaxonItemSchema, FormSchema, FormField } from "@klaxon/protocol";
import { DraggablePanel } from "../components/DraggablePanel";

function badgeColor(level: string) {
  switch (level) {
    case "error": return "var(--danger)";
    case "warning": return "var(--warn)";
    case "success": return "var(--ok)";
    default: return "var(--info)";
  }
}

export function KlaxonWidget() {
  const [items, setItems] = useState<KlaxonItem[]>([]);
  const [busy, setBusy] = useState(false);

  async function refresh() {
    setBusy(true);
    try {
      const raw = (await invoke("klaxon_list_open")) as unknown[];
      setItems(raw.map(i => KlaxonItemSchema.parse(i)));
    } catch (err) {
      console.error("[KlaxonWidget] refresh failed:", err);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (typeof Notification !== "undefined" && Notification.permission === "default") {
      Notification.requestPermission();
    }
    refresh();
    const u1 = listen("klaxon.updated", () => refresh());
    const u2 = listen<KlaxonItem>("klaxon.created", (event) => {
      refresh();
      if (typeof Notification !== "undefined" && Notification.permission === "granted") {
        new Notification(event.payload.title, { body: event.payload.message });
      }
    });
    return () => { u1.then(u => u()); u2.then(u => u()); };
  }, []);

  return (
    <DraggablePanel id="klaxon" title="Klaxon" width={380}>
      <div style={{ display:"flex", gap:8, alignItems:"center", justifyContent:"space-between", marginBottom: 10 }}>
        <div style={{ fontSize: 12, opacity: 0.7 }}>{items.length} open</div>
        <button onClick={refresh} disabled={busy} style={{ background:"transparent", border:"1px solid var(--border)", color:"var(--text)", borderRadius: 10, padding:"6px 10px" }}>
          {busy ? "…" : "Refresh"}
        </button>
      </div>

      <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
        {items.map(item => (
          <KlaxonCard key={item.id} item={item} onChanged={refresh} />
        ))}
        {items.length === 0 && (
          <div style={{ fontSize: 13, opacity: 0.7 }}>No active klaxons.</div>
        )}
      </div>
    </DraggablePanel>
  );
}

function KlaxonCard({ item, onChanged }: { item: KlaxonItem; onChanged: () => void }) {
  const [values, setValues] = useState<Record<string, any>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const form = item.form ?? null;

  async function ack() {
    await invoke("klaxon_ack", { id: item.id });
    onChanged();
  }

  async function dismiss() {
    await invoke("klaxon_dismiss", { id: item.id });
    onChanged();
  }

  async function runAction(actionId: string) {
    await invoke("klaxon_run_action", { id: item.id, actionId });
    onChanged();
  }

  function validateField(f: FormField, v: any): string | null {
    if (f.required && (v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0))) {
      return "Required";
    }
    if (f.type === "text" || f.type === "textarea") {
      if (typeof v === "string") {
        if (f.min_len !== undefined && v.length < f.min_len) return `Min length ${f.min_len}`;
        if (f.max_len !== undefined && v.length > f.max_len) return `Max length ${f.max_len}`;
        if (f.pattern) {
          try {
            const r = new RegExp(f.pattern);
            if (!r.test(v)) return "Does not match pattern";
          } catch {
            // ignore bad pattern
          }
        }
      }
    }
    if (f.type === "number") {
      const n = Number(v);
      if (!Number.isFinite(n)) return "Must be a number";
      if (f.min !== undefined && n < f.min) return `Min ${f.min}`;
      if (f.max !== undefined && n > f.max) return `Max ${f.max}`;
    }
    return null;
  }

  async function submit() {
    if (!form) return;

    const nextErrors: Record<string, string> = {};
    for (const f of form.fields) {
      const err = validateField(f, values[f.id]);
      if (err) nextErrors[f.id] = err;
    }
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    await invoke("klaxon_answer", { id: item.id, response: values });
    onChanged();
  }

  return (
    <div style={{ background:"var(--card)", border:"1px solid var(--border)", borderRadius: 12, padding: 12 }}>
      <div style={{ display:"flex", alignItems:"flex-start", justifyContent:"space-between", gap:8 }}>
        <div>
          <div style={{ display:"flex", alignItems:"center", gap:8 }}>
            <span style={{ width:10, height:10, borderRadius:99, background: badgeColor(item.level) }} />
            <div style={{ fontWeight: 700 }}>{item.title}</div>
          </div>
          {item.message && (
            <div className="klaxon-md" style={{ marginTop: 6, fontSize: 13, opacity: 0.85 }}>
              <ReactMarkdown>{item.message}</ReactMarkdown>
            </div>
          )}
        </div>
        <div style={{ display:"flex", gap:6 }}>
          <button onClick={ack} style={btnStyle()}>Ack</button>
          <button onClick={dismiss} style={btnStyle()}>Dismiss</button>
        </div>
      </div>

      {item.actions?.length ? (
        <div style={{ display:"flex", flexWrap:"wrap", gap:8, marginTop: 10 }}>
          {item.actions.map(a => (
            <button key={a.id} onClick={() => runAction(a.id)} style={btnStyle()}>
              {a.label}
            </button>
          ))}
        </div>
      ) : null}

      {form ? (
        <div style={{ marginTop: 12 }}>
          <div style={{ fontSize: 12, opacity: 0.7, marginBottom: 8 }}>{form.description ?? "Question"}</div>
          <FormRenderer form={form} values={values} errors={errors} onChange={setValues} />
          <div style={{ display:"flex", gap:8, marginTop: 10 }}>
            <button onClick={submit} style={primaryBtnStyle()}>{form.submitLabel ?? "Submit"}</button>
            <button onClick={() => dismiss()} style={btnStyle()}>{form.cancelLabel ?? "Cancel"}</button>
          </div>
        </div>
      ) : null}
      {item.ttl_ms && <TtlBar createdAt={item.created_at} ttlMs={item.ttl_ms} />}
    </div>
  );
}

function btnStyle(): React.CSSProperties {
  return {
    background:"transparent",
    border:"1px solid var(--border)",
    color:"var(--text)",
    borderRadius: 10,
    padding:"6px 10px",
    fontSize: 12,
  };
}
function primaryBtnStyle(): React.CSSProperties {
  return {
    background:"rgba(90, 169, 255, 0.18)",
    border:"1px solid rgba(90, 169, 255, 0.5)",
    color:"var(--text)",
    borderRadius: 10,
    padding:"6px 10px",
    fontSize: 12,
  };
}

function FormRenderer({ form, values, errors, onChange }:{
  form: FormSchema;
  values: Record<string, any>;
  errors: Record<string, string>;
  onChange: (v: Record<string, any>) => void;
}) {
  return (
    <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
      {form.fields.map(f => (
        <Field key={f.id} field={f} value={values[f.id]} error={errors[f.id]} onChange={(v) => onChange({ ...values, [f.id]: v })} />
      ))}
    </div>
  );
}

function Field({ field, value, error, onChange }:{
  field: FormField;
  value: any;
  error?: string;
  onChange: (v: any) => void;
}) {
  const label = (
    <div style={{ display:"flex", alignItems:"baseline", justifyContent:"space-between" }}>
      <div style={{ fontSize: 12, fontWeight: 650, opacity: 0.95 }}>
        {field.label}{field.required ? <span style={{ color:"var(--warn)" }}> *</span> : null}
      </div>
      {error ? <div style={{ fontSize: 11, color:"var(--danger)" }}>{error}</div> : null}
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
          <input style={commonInput} value={value ?? ""} placeholder={field.placeholder ?? ""} onChange={e => onChange(e.target.value)} />
        </div>
      );
    case "textarea":
      return (
        <div>
          {label}
          <textarea style={{...commonInput, minHeight: 72}} value={value ?? ""} placeholder={field.placeholder ?? ""} onChange={e => onChange(e.target.value)} />
        </div>
      );
    case "number":
      return (
        <div>
          {label}
          <input style={commonInput} type="number" value={value ?? ""} onChange={e => onChange(e.target.value)} />
        </div>
      );
    case "select":
      return (
        <div>
          {label}
          <select style={commonInput} value={value ?? ""} onChange={e => onChange(e.target.value)}>
            <option value="" disabled>Select…</option>
            {field.options?.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
      );
    case "multiselect":
      return (
        <div>
          {label}
          <select style={commonInput} multiple value={Array.isArray(value) ? value : []} onChange={e => {
            const selected = Array.from(e.target.selectedOptions).map(o => o.value);
            onChange(selected);
          }}>
            {field.options?.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
      );
    case "radio":
      return (
        <div>
          {label}
          <div style={{ display:"flex", flexDirection:"column", gap:6, marginTop: 6 }}>
            {field.options?.map(o => (
              <label key={o.value} style={{ display:"flex", gap:8, alignItems:"center", fontSize: 13, opacity: 0.9 }}>
                <input type="radio" name={field.id} checked={value === o.value} onChange={() => onChange(o.value)} />
                {o.label}
              </label>
            ))}
          </div>
        </div>
      );
    case "checkbox":
      return (
        <div>
          {label}
          <label style={{ display:"flex", gap:8, alignItems:"center", marginTop: 6, fontSize: 13, opacity: 0.9 }}>
            <input type="checkbox" checked={!!value} onChange={e => onChange(e.target.checked)} />
            {field.help ?? "Enabled"}
          </label>
        </div>
      );
    case "toggle":
      return (
        <div>
          {label}
          <label style={{ display:"flex", gap:8, alignItems:"center", marginTop: 6, fontSize: 13, opacity: 0.9 }}>
            <input type="checkbox" checked={!!value} onChange={e => onChange(e.target.checked)} />
            {field.help ?? (value ? "On" : "Off")}
          </label>
        </div>
      );
    case "datetime":
      return (
        <div>
          {label}
          <input style={commonInput} type="datetime-local" value={value ?? ""} onChange={e => onChange(e.target.value)} />
        </div>
      );
    case "issuepicker":
      return (
        <div>
          {label}
          <input style={commonInput} list={`${field.id}-issues`} value={value ?? ""} placeholder={field.placeholder ?? "PROJ-123"} onChange={e => onChange(e.target.value)} />
          <datalist id={`${field.id}-issues`}>
            {(field.suggestions ?? []).map(s => <option key={s} value={s} />)}
          </datalist>
          {field.help ? <div style={{ fontSize: 12, opacity: 0.65, marginTop: 6 }}>{field.help}</div> : null}
        </div>
      );
    case "diffapproval":
      return (
        <div>
          {label}
          <div style={{ marginTop: 6, border:"1px solid var(--border)", borderRadius: 10, padding: 8, background:"rgba(0,0,0,0.18)" }}>
            <div style={{ fontSize: 12, opacity: 0.75, marginBottom: 6 }}>{field.summary ?? "Proposed changes"}</div>
            <DiffView diff={field.diff ?? ""} />
            <div style={{ display:"flex", gap:8, marginTop: 8 }}>
              <button style={primaryBtnStyle()} onClick={() => onChange("approve")}>Approve</button>
              <button style={btnStyle()} onClick={() => onChange("reject")}>Reject</button>
            </div>
          </div>
        </div>
      );
    default:
      return (
        <div>
          {label}
          <div style={{ fontSize: 12, opacity: 0.6, marginTop: 6 }}>Unsupported field type: {(field as any).type}</div>
        </div>
      );
  }
}

function DiffView({ diff }: { diff: string }) {
  return (
    <pre style={{ margin: 0, fontSize: 11, whiteSpace: "pre-wrap", opacity: 0.9 }}>
      {diff.split('\n').map((line, i) => {
        const color =
          line.startsWith('+') ? 'var(--ok)'
        : line.startsWith('-') ? 'var(--danger)'
        : line.startsWith('@') ? 'var(--info)'
        : undefined;
        return <span key={i} style={{ color, display: 'block' }}>{line}</span>;
      })}
    </pre>
  );
}

function TtlBar({ createdAt, ttlMs }: { createdAt: string; ttlMs: number }) {
  const [pct, setPct] = useState(() => {
    const elapsed = Date.now() - new Date(createdAt).getTime();
    return Math.max(0, ((ttlMs - elapsed) / ttlMs) * 100);
  });
  useEffect(() => {
    const id = setInterval(() => {
      setPct(() => {
        const elapsed = Date.now() - new Date(createdAt).getTime();
        return Math.max(0, ((ttlMs - elapsed) / ttlMs) * 100);
      });
    }, 250);
    return () => clearInterval(id);
  }, [createdAt, ttlMs]);

  const color = pct > 50 ? 'var(--ok)' : pct > 20 ? 'var(--warn)' : 'var(--danger)';
  return (
    <div style={{ height: 3, background: 'rgba(255,255,255,0.08)', borderRadius: '0 0 10px 10px', overflow: 'hidden', marginTop: 10 }}>
      <div style={{ height: '100%', width: `${pct}%`, background: color, transition: 'width 0.25s linear' }} />
    </div>
  );
}
