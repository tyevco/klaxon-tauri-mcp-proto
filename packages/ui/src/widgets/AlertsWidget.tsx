import React, { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { AlertRule } from "@klaxon/protocol";
import { DraggablePanel } from "../components/DraggablePanel";

const KIND_LABELS: Record<string, string> = {
  cost: "Daily cost ($)",
  timer: "Timer duration (hrs)",
  klaxon_count: "Open klaxons",
};

const LEVEL_COLORS: Record<string, string> = {
  info:    "var(--info)",
  warning: "var(--warn)",
  error:   "var(--danger)",
  success: "var(--ok)",
};

function relTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

const EMPTY_FORM = { kind: "cost", threshold: "", level: "warning", message: "" };

export function AlertsWidget() {
  const [rules, setRules] = useState<AlertRule[]>([]);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);

  async function refresh() {
    try {
      const raw = await invoke<AlertRule[]>("alerts_list");
      setRules(raw ?? []);
    } catch {}
  }

  useEffect(() => {
    refresh();
    const u1 = listen("alerts.updated", () => refresh());
    const u2 = listen("klaxon.created", () => refresh()); // in case alert fired
    return () => { u1.then(u => u()); u2.then(u => u()); };
  }, []);

  async function createRule() {
    const thresh = parseFloat(form.threshold);
    if (isNaN(thresh)) return;
    if (!form.message.trim()) return;
    try {
      await invoke("alerts_create", {
        kind: form.kind,
        threshold: thresh,
        level: form.level,
        message: form.message.trim(),
      });
      setAdding(false);
      setForm(EMPTY_FORM);
    } catch {}
  }

  async function toggleEnabled(rule: AlertRule) {
    try {
      await invoke("alerts_update", {
        id: rule.id,
        kind: rule.kind,
        threshold: rule.threshold,
        level: rule.level,
        message: rule.message,
        enabled: !rule.enabled,
      });
    } catch {}
  }

  async function deleteRule(id: number) {
    try {
      await invoke("alerts_delete", { id });
    } catch {}
  }

  return (
    <DraggablePanel id="alerts" title="Alert Rules" width={360}>
      <div style={{ display: "flex", flexDirection: "column", gap: 6, overflowY: "auto", maxHeight: 400, marginBottom: 8 }}>
        {rules.length === 0 && !adding ? (
          <div style={{ fontSize: 12, opacity: 0.45 }}>No rules yet. Add one to get passive monitoring.</div>
        ) : rules.map(rule => (
          <div
            key={rule.id}
            style={{
              background: "var(--card)", border: "1px solid var(--border)", borderRadius: 8,
              padding: "7px 10px", opacity: rule.enabled ? 1 : 0.5,
              borderLeft: `3px solid ${LEVEL_COLORS[rule.level] ?? "var(--border)"}`,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{
                fontSize: 9, padding: "1px 5px", borderRadius: 10,
                background: "var(--border)", color: "var(--muted)",
              }}>
                {rule.kind}
              </span>
              <span style={{ fontSize: 11, fontWeight: 600, flex: 1 }}>
                &gt; {rule.threshold} → {rule.message}
              </span>
              <label style={{ display: "flex", alignItems: "center", gap: 3, cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={rule.enabled}
                  onChange={() => toggleEnabled(rule)}
                  style={{ cursor: "pointer" }}
                />
                <span style={{ fontSize: 10 }}>{rule.enabled ? "On" : "Off"}</span>
              </label>
              <button
                onClick={() => deleteRule(rule.id)}
                style={{
                  fontSize: 11, padding: "1px 6px", borderRadius: 4, cursor: "pointer",
                  background: "none", border: "1px solid var(--danger)", color: "var(--danger)",
                }}
              >
                ✕
              </button>
            </div>
            {rule.last_fired_at && (
              <div style={{ fontSize: 10, opacity: 0.45, marginTop: 3 }}>
                Last fired: {relTime(rule.last_fired_at)}
              </div>
            )}
          </div>
        ))}
      </div>

      {adding && (
        <div style={{
          background: "var(--card)", border: "1px solid var(--border)", borderRadius: 8,
          padding: "10px", marginBottom: 8, display: "flex", flexDirection: "column", gap: 6,
        }}>
          <select
            value={form.kind}
            onChange={e => setForm(f => ({ ...f, kind: e.target.value }))}
            style={{ background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 6, padding: "4px 8px", color: "var(--text)", fontSize: 12 }}
          >
            <option value="cost">Daily cost ($)</option>
            <option value="timer">Timer duration (hrs)</option>
            <option value="klaxon_count">Open klaxons (#)</option>
          </select>
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <span style={{ fontSize: 11, opacity: 0.6, flexShrink: 0 }}>Alert if &gt;</span>
            <input
              type="number"
              value={form.threshold}
              onChange={e => setForm(f => ({ ...f, threshold: e.target.value }))}
              placeholder={KIND_LABELS[form.kind] ?? "threshold"}
              style={{
                flex: 1, background: "var(--bg)", border: "1px solid var(--border)",
                borderRadius: 6, padding: "4px 8px", color: "var(--text)", fontSize: 12,
              }}
            />
          </div>
          <select
            value={form.level}
            onChange={e => setForm(f => ({ ...f, level: e.target.value }))}
            style={{ background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 6, padding: "4px 8px", color: "var(--text)", fontSize: 12 }}
          >
            <option value="info">Info</option>
            <option value="warning">Warning</option>
            <option value="error">Error</option>
          </select>
          <input
            type="text"
            value={form.message}
            onChange={e => setForm(f => ({ ...f, message: e.target.value }))}
            placeholder="Alert message"
            style={{
              background: "var(--bg)", border: "1px solid var(--border)",
              borderRadius: 6, padding: "4px 8px", color: "var(--text)", fontSize: 12,
            }}
          />
          <div style={{ display: "flex", gap: 6 }}>
            <button
              onClick={createRule}
              style={{
                flex: 1, padding: "5px", borderRadius: 6, cursor: "pointer",
                background: "var(--ok)", border: "none", color: "#fff", fontSize: 12,
              }}
            >
              Add Rule
            </button>
            <button
              onClick={() => { setAdding(false); setForm(EMPTY_FORM); }}
              style={{
                padding: "5px 10px", borderRadius: 6, cursor: "pointer",
                background: "var(--card)", border: "1px solid var(--border)", color: "var(--text)", fontSize: 12,
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {!adding && (
        <button
          onClick={() => setAdding(true)}
          style={{
            width: "100%", padding: "6px", borderRadius: 8, cursor: "pointer",
            background: "var(--card)", border: "1px dashed var(--border)", color: "var(--text)", fontSize: 12,
          }}
        >
          + Add Rule
        </button>
      )}
    </DraggablePanel>
  );
}
