import React, { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { DraggablePanel } from "../components/DraggablePanel";

interface AppSettings {
  theme: string;
  mcp_preferred_port: number;
}

interface McpStatus {
  url: string;
  bearer: string;
}

const THEMES = [
  { id: "dark",    label: "Dark" },
  { id: "light",   label: "Light" },
  { id: "dracula", label: "Dracula" },
  { id: "nord",    label: "Nord" },
] as const;

function ThemeTab({ settings, onSettingsChange }: { settings: AppSettings; onSettingsChange: (s: AppSettings) => void }) {
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
              border: settings.theme === id
                ? "2px solid var(--info)"
                : "2px solid var(--border)",
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

function McpTab({ settings, onSettingsChange }: { settings: AppSettings; onSettingsChange: (s: AppSettings) => void }) {
  const [status, setStatus] = useState<McpStatus | null>(null);
  const [portInput, setPortInput] = useState(String(settings.mcp_preferred_port));
  const [copied, setCopied] = useState<"url" | "token" | null>(null);

  useEffect(() => {
    invoke<McpStatus | null>("mcp_get_status").then(setStatus).catch(console.error);
    const unsub = listen<{ url: string; token: string }>("mcp.ready", (e) => {
      setStatus({ url: e.payload.url, bearer: e.payload.token });
    });
    return () => { unsub.then(u => u()); };
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
    display: "flex", alignItems: "center", gap: 8, padding: "6px 0",
    borderBottom: "1px solid var(--border)",
  };
  const labelStyle: React.CSSProperties = { color: "var(--muted)", fontSize: 11, width: 52, flexShrink: 0 };
  const monoStyle: React.CSSProperties = { fontFamily: "ui-monospace, monospace", fontSize: 11, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" };
  const btnStyle: React.CSSProperties = { padding: "2px 8px", fontSize: 11, background: "var(--card)", border: "1px solid var(--border)", borderRadius: 4, color: "var(--text)", cursor: "pointer", flexShrink: 0 };

  return (
    <div style={{ padding: "12px 0" }}>
      <div style={rowStyle}>
        <span style={labelStyle}>Status</span>
        {status
          ? <span style={{ color: "var(--ok)", fontSize: 13 }}>● Connected</span>
          : <span style={{ color: "var(--muted)", fontSize: 13 }}>◌ Waiting…</span>
        }
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
            flex: 1, padding: "3px 6px", fontSize: 11, background: "var(--card)",
            border: "1px solid var(--border)", borderRadius: 4, color: "var(--text)",
            fontFamily: "ui-monospace, monospace",
          }}
        />
        <button style={btnStyle} onClick={savePort}>Save</button>
      </div>

      <p style={{ color: "var(--muted)", fontSize: 10, margin: "8px 0 0", lineHeight: 1.4 }}>
        *Port change takes effect on next restart
      </p>
    </div>
  );
}

export function SettingsWidget() {
  const [tab, setTab] = useState<"theme" | "mcp">("theme");
  const [settings, setSettings] = useState<AppSettings>({ theme: "dark", mcp_preferred_port: 0 });

  useEffect(() => {
    invoke<AppSettings>("settings_get").then(setSettings).catch(console.error);
  }, []);

  const tabBtnStyle = (active: boolean): React.CSSProperties => ({
    flex: 1, padding: "6px 0", fontSize: 12, fontWeight: active ? 600 : 400,
    background: active ? "var(--card)" : "transparent",
    border: "none", borderBottom: active ? "2px solid var(--info)" : "2px solid transparent",
    color: active ? "var(--text)" : "var(--muted)", cursor: "pointer",
  });

  return (
    <DraggablePanel id="settings" title="Settings" width={340}>
      <div style={{ display: "flex", borderBottom: "1px solid var(--border)", marginBottom: 4 }}>
        <button style={tabBtnStyle(tab === "theme")} onClick={() => setTab("theme")}>Theme</button>
        <button style={tabBtnStyle(tab === "mcp")} onClick={() => setTab("mcp")}>MCP</button>
      </div>
      {tab === "theme"
        ? <ThemeTab settings={settings} onSettingsChange={setSettings} />
        : <McpTab settings={settings} onSettingsChange={setSettings} />
      }
    </DraggablePanel>
  );
}
