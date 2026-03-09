import React, { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { AlertRule, AppSettings } from "@klaxon/protocol";
import { DraggablePanel } from "../components/DraggablePanel";

interface McpStatus {
  url: string;
  bearer: string;
}

const THEMES = [
  { id: "dark", label: "Dark" },
  { id: "light", label: "Light" },
  { id: "dracula", label: "Dracula" },
  { id: "nord", label: "Nord" },
] as const;

function ThemeTab({
  settings,
  onSettingsChange,
}: {
  settings: AppSettings;
  onSettingsChange: (s: AppSettings) => void;
}) {
  const selectTheme = (theme: string) => {
    const next = { ...settings, theme };
    invoke("settings_set", { settings: next }).catch(console.error);
    document.documentElement.dataset.theme = theme;
    onSettingsChange(next);
  };

  return (
    <div style={{ padding: "12px 0" }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        {THEMES.map(({ id, label }) => (
          <button
            key={id}
            onClick={() => selectTheme(id)}
            style={{
              padding: "10px 0",
              borderRadius: 8,
              border: settings.theme === id ? "2px solid var(--info)" : "2px solid var(--border)",
              background: settings.theme === id ? "var(--card)" : "transparent",
              color: "var(--text)",
              fontWeight: settings.theme === id ? 600 : 400,
              fontSize: 13,
              cursor: "pointer",
              transition: "border-color 0.15s, background 0.15s",
            }}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}

function McpTab({
  settings,
  onSettingsChange,
}: {
  settings: AppSettings;
  onSettingsChange: (s: AppSettings) => void;
}) {
  const [status, setStatus] = useState<McpStatus | null>(null);
  const [portInput, setPortInput] = useState(String(settings.mcp_preferred_port));
  const [copied, setCopied] = useState<"url" | "token" | null>(null);

  useEffect(() => {
    invoke<McpStatus | null>("mcp_get_status").then(setStatus).catch(console.error);
    const unsub = listen<{ url: string; token: string }>("mcp.ready", e => {
      setStatus({ url: e.payload.url, bearer: e.payload.token });
    });
    return () => {
      unsub.then(u => u());
    };
  }, []);

  const copy = (text: string, which: "url" | "token") => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(which);
      setTimeout(() => setCopied(null), 1500);
    });
  };

  const savePort = () => {
    const p = Math.max(0, Math.min(65535, parseInt(portInput, 10) || 0));
    const next = { ...settings, mcp_preferred_port: p };
    invoke("settings_set", { settings: next }).catch(console.error);
    onSettingsChange(next);
  };

  const rowStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "6px 0",
    borderBottom: "1px solid var(--border)",
  };
  const labelStyle: React.CSSProperties = {
    color: "var(--muted)",
    fontSize: 11,
    width: 52,
    flexShrink: 0,
  };
  const monoStyle: React.CSSProperties = {
    fontFamily: "ui-monospace, monospace",
    fontSize: 11,
    flex: 1,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  };
  const btnStyle: React.CSSProperties = {
    padding: "2px 8px",
    fontSize: 11,
    background: "var(--card)",
    border: "1px solid var(--border)",
    borderRadius: 4,
    color: "var(--text)",
    cursor: "pointer",
    flexShrink: 0,
  };

  return (
    <div style={{ padding: "12px 0" }}>
      <div style={rowStyle}>
        <span style={labelStyle}>Status</span>
        {status ? (
          <span style={{ color: "var(--ok)", fontSize: 13 }}>● Connected</span>
        ) : (
          <span style={{ color: "var(--muted)", fontSize: 13 }}>◌ Waiting…</span>
        )}
      </div>

      <div style={rowStyle}>
        <span style={labelStyle}>URL</span>
        <span style={monoStyle}>{status?.url ?? "—"}</span>
        {status && (
          <button style={btnStyle} onClick={() => copy(status.url, "url")}>
            {copied === "url" ? "✓" : "Copy"}
          </button>
        )}
      </div>

      <div style={rowStyle}>
        <span style={labelStyle}>Token</span>
        <span style={monoStyle}>{status ? `${status.bearer.slice(0, 12)}…` : "—"}</span>
        {status && (
          <button style={btnStyle} onClick={() => copy(status.bearer, "token")}>
            {copied === "token" ? "✓" : "Copy"}
          </button>
        )}
      </div>

      <div style={{ ...rowStyle, borderBottom: "none", alignItems: "center" }}>
        <span style={labelStyle}>Port*</span>
        <input
          type="number"
          min={0}
          max={65535}
          value={portInput}
          onChange={e => setPortInput(e.target.value)}
          placeholder="0 = auto"
          style={{
            flex: 1,
            padding: "3px 6px",
            fontSize: 11,
            background: "var(--card)",
            border: "1px solid var(--border)",
            borderRadius: 4,
            color: "var(--text)",
            fontFamily: "ui-monospace, monospace",
          }}
        />
        <button style={btnStyle} onClick={savePort}>
          Save
        </button>
      </div>

      <p style={{ color: "var(--muted)", fontSize: 10, margin: "8px 0 0", lineHeight: 1.4 }}>
        *Port change takes effect on next restart
      </p>
    </div>
  );
}

const KIND_LABELS: Record<string, string> = {
  cost: "Daily cost ($)",
  timer: "Timer duration (hrs)",
  klaxon_count: "Open klaxons",
};

const LEVEL_COLORS: Record<string, string> = {
  info: "var(--info)",
  warning: "var(--warn)",
  error: "var(--danger)",
  success: "var(--ok)",
};

function alertRelTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

const EMPTY_FORM = { kind: "cost", threshold: "", level: "warning", message: "" };

function AlertsTab() {
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
    const u2 = listen("klaxon.created", () => refresh());
    return () => {
      u1.then(u => u());
      u2.then(u => u());
    };
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
    <div style={{ padding: "12px 0" }}>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 6,
          overflowY: "auto",
          maxHeight: 340,
          marginBottom: 8,
        }}
      >
        {rules.length === 0 && !adding ? (
          <div style={{ fontSize: 12, opacity: 0.45 }}>
            No rules yet. Add one to get passive monitoring.
          </div>
        ) : (
          rules.map(rule => (
            <div
              key={rule.id}
              style={{
                background: "var(--card)",
                border: "1px solid var(--border)",
                borderRadius: 8,
                padding: "7px 10px",
                opacity: rule.enabled ? 1 : 0.5,
                borderLeft: `3px solid ${LEVEL_COLORS[rule.level] ?? "var(--border)"}`,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span
                  style={{
                    fontSize: 9,
                    padding: "1px 5px",
                    borderRadius: 10,
                    background: "var(--border)",
                    color: "var(--muted)",
                  }}
                >
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
                    fontSize: 11,
                    padding: "1px 6px",
                    borderRadius: 4,
                    cursor: "pointer",
                    background: "none",
                    border: "1px solid var(--danger)",
                    color: "var(--danger)",
                  }}
                >
                  ✕
                </button>
              </div>
              {rule.last_fired_at && (
                <div style={{ fontSize: 10, opacity: 0.45, marginTop: 3 }}>
                  Last fired: {alertRelTime(rule.last_fired_at)}
                </div>
              )}
            </div>
          ))
        )}
      </div>

      {adding && (
        <div
          style={{
            background: "var(--card)",
            border: "1px solid var(--border)",
            borderRadius: 8,
            padding: "10px",
            marginBottom: 8,
            display: "flex",
            flexDirection: "column",
            gap: 6,
          }}
        >
          <select
            value={form.kind}
            onChange={e => setForm(f => ({ ...f, kind: e.target.value }))}
            style={{
              background: "var(--bg)",
              border: "1px solid var(--border)",
              borderRadius: 6,
              padding: "4px 8px",
              color: "var(--text)",
              fontSize: 12,
            }}
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
                flex: 1,
                background: "var(--bg)",
                border: "1px solid var(--border)",
                borderRadius: 6,
                padding: "4px 8px",
                color: "var(--text)",
                fontSize: 12,
              }}
            />
          </div>
          <select
            value={form.level}
            onChange={e => setForm(f => ({ ...f, level: e.target.value }))}
            style={{
              background: "var(--bg)",
              border: "1px solid var(--border)",
              borderRadius: 6,
              padding: "4px 8px",
              color: "var(--text)",
              fontSize: 12,
            }}
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
              background: "var(--bg)",
              border: "1px solid var(--border)",
              borderRadius: 6,
              padding: "4px 8px",
              color: "var(--text)",
              fontSize: 12,
            }}
          />
          <div style={{ display: "flex", gap: 6 }}>
            <button
              onClick={createRule}
              style={{
                flex: 1,
                padding: "5px",
                borderRadius: 6,
                cursor: "pointer",
                background: "var(--ok)",
                border: "none",
                color: "#fff",
                fontSize: 12,
              }}
            >
              Add Rule
            </button>
            <button
              onClick={() => {
                setAdding(false);
                setForm(EMPTY_FORM);
              }}
              style={{
                padding: "5px 10px",
                borderRadius: 6,
                cursor: "pointer",
                background: "var(--card)",
                border: "1px solid var(--border)",
                color: "var(--text)",
                fontSize: 12,
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
            width: "100%",
            padding: "6px",
            borderRadius: 8,
            cursor: "pointer",
            background: "var(--card)",
            border: "1px dashed var(--border)",
            color: "var(--text)",
            fontSize: 12,
          }}
        >
          + Add Rule
        </button>
      )}
    </div>
  );
}

export function SettingsWidget() {
  const [tab, setTab] = useState<"theme" | "mcp" | "alerts">("theme");
  const [settings, setSettings] = useState<AppSettings>({
    theme: "dark",
    mcp_preferred_port: 0,
    budget_usd_daily: 0,
  });

  useEffect(() => {
    invoke<AppSettings>("settings_get").then(setSettings).catch(console.error);
  }, []);

  const tabBtnStyle = (active: boolean): React.CSSProperties => ({
    flex: 1,
    padding: "6px 0",
    fontSize: 12,
    fontWeight: active ? 600 : 400,
    background: active ? "var(--card)" : "transparent",
    border: "none",
    borderBottom: active ? "2px solid var(--info)" : "2px solid transparent",
    color: active ? "var(--text)" : "var(--muted)",
    cursor: "pointer",
  });

  return (
    <DraggablePanel id="settings" title="Settings" width={360}>
      <div style={{ display: "flex", borderBottom: "1px solid var(--border)", marginBottom: 4 }}>
        <button style={tabBtnStyle(tab === "theme")} onClick={() => setTab("theme")}>
          Theme
        </button>
        <button style={tabBtnStyle(tab === "mcp")} onClick={() => setTab("mcp")}>
          MCP
        </button>
        <button style={tabBtnStyle(tab === "alerts")} onClick={() => setTab("alerts")}>
          Alerts
        </button>
      </div>
      {tab === "theme" && <ThemeTab settings={settings} onSettingsChange={setSettings} />}
      {tab === "mcp" && <McpTab settings={settings} onSettingsChange={setSettings} />}
      {tab === "alerts" && <AlertsTab />}
    </DraggablePanel>
  );
}
