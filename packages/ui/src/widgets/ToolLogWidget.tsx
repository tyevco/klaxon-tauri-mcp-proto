import React, { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { ToolCallEntry } from "@klaxon/protocol";
import { DraggablePanel } from "../components/DraggablePanel";
import { relTime } from "../utils";

export function ToolLogWidget() {
  const [entries, setEntries] = useState<ToolCallEntry[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [toolFilter, setToolFilter] = useState("");
  const [paused, setPaused] = useState(false);
  const pausedRef = useRef(paused);
  pausedRef.current = paused;

  async function refresh() {
    if (pausedRef.current) return;
    try {
      const raw = await invoke<ToolCallEntry[]>("toollog_recent", { n: 200 });
      setEntries((raw ?? []).reverse()); // newest first
    } catch {}
  }

  useEffect(() => {
    refresh();
    const u1 = listen("toollog.updated", () => refresh());
    return () => {
      u1.then(u => u());
    };
  }, [paused]);

  const tools = [...new Set(entries.map(e => e.tool))];
  const filtered = toolFilter ? entries.filter(e => e.tool === toolFilter) : entries;

  return (
    <DraggablePanel id="toollog" title="Tool Log" width={540}>
      <div
        style={{ display: "flex", gap: 6, marginBottom: 8, alignItems: "center", flexWrap: "wrap" }}
      >
        <select
          value={toolFilter}
          onChange={e => setToolFilter(e.target.value)}
          style={{
            flex: 1,
            background: "var(--card)",
            border: "1px solid var(--border)",
            borderRadius: 6,
            padding: "3px 8px",
            color: "var(--text)",
            fontSize: 11,
          }}
        >
          <option value="">All tools ({entries.length})</option>
          {tools.map(t => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <button
          onClick={() => setPaused(p => !p)}
          style={{
            fontSize: 11,
            padding: "3px 8px",
            borderRadius: 6,
            cursor: "pointer",
            background: paused ? "var(--warn)" : "var(--card)",
            border: `1px solid ${paused ? "var(--warn)" : "var(--border)"}`,
            color: paused ? "#fff" : "var(--text)",
          }}
        >
          {paused ? "Resume" : "Pause"}
        </button>
        <button
          onClick={async () => {
            await invoke("toollog_clear");
            setEntries([]);
          }}
          style={{
            fontSize: 11,
            padding: "3px 8px",
            borderRadius: 6,
            cursor: "pointer",
            background: "var(--card)",
            border: "1px solid var(--border)",
            color: "var(--text)",
          }}
        >
          Clear
        </button>
      </div>

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 3,
          overflowY: "auto",
          maxHeight: 420,
        }}
      >
        {filtered.length === 0 ? (
          <div style={{ fontSize: 12, opacity: 0.45 }}>No tool calls recorded yet.</div>
        ) : (
          filtered.map(e => {
            const eKey = `${e.called_at}-${e.tool}-${e.client_id}`;
            const isExpanded = expanded === eKey;
            return (
              <div
                key={eKey}
                style={{
                  background: "var(--card)",
                  border: "1px solid var(--border)",
                  borderRadius: 6,
                  padding: "5px 8px",
                  borderLeft: `3px solid ${e.ok ? "var(--ok)" : "var(--danger)"}`,
                  cursor: "pointer",
                }}
                onClick={() => setExpanded(isExpanded ? null : eKey)}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 600,
                      fontFamily: "monospace",
                      color: e.ok ? "var(--ok)" : "var(--danger)",
                      flexShrink: 0,
                    }}
                  >
                    {e.ok ? "✓" : "✗"}
                  </span>
                  <span style={{ flex: 1, fontSize: 12, fontFamily: "monospace", fontWeight: 600 }}>
                    {e.tool}
                  </span>
                  <span style={{ fontSize: 10, opacity: 0.5 }}>{e.duration_ms}ms</span>
                  <span style={{ fontSize: 10, opacity: 0.4, whiteSpace: "nowrap" }}>
                    {relTime(e.called_at)}
                  </span>
                </div>
                {!isExpanded && (
                  <div
                    style={{
                      fontSize: 10,
                      opacity: 0.55,
                      marginTop: 2,
                      fontFamily: "monospace",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {e.args_summary}
                  </div>
                )}
                {isExpanded && (
                  <div style={{ marginTop: 6, fontSize: 11 }}>
                    <div style={{ opacity: 0.6, marginBottom: 3 }}>
                      Client: <code>{e.client_id || "unknown"}</code>
                    </div>
                    <div
                      style={{
                        fontFamily: "monospace",
                        padding: "4px 6px",
                        background: "var(--bg)",
                        borderRadius: 4,
                        wordBreak: "break-all",
                      }}
                    >
                      {e.args_summary}
                    </div>
                    {e.error && (
                      <div style={{ color: "var(--danger)", marginTop: 4, fontSize: 11 }}>
                        Error: {e.error}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </DraggablePanel>
  );
}
