import React, { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { AgentInfo } from "@klaxon/protocol";
import { DraggablePanel } from "../components/DraggablePanel";
import { relTime } from "../utils";

function dotColor(lastSeenIso: string): string {
  const s = Math.floor((Date.now() - new Date(lastSeenIso).getTime()) / 1000);
  if (s < 10) return "var(--ok)";
  if (s < 60) return "var(--warn)";
  return "var(--muted)";
}

export function AgentsWidget() {
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [, setTick] = useState(0);

  async function refresh() {
    try {
      const raw = await invoke<AgentInfo[]>("mcp_list_agents");
      setAgents(raw ?? []);
    } catch {}
  }

  useEffect(() => {
    refresh();
    const unsub = listen("agents.updated", () => refresh());
    const interval = setInterval(() => setTick(t => t + 1), 5000);
    return () => {
      unsub.then(u => u());
      clearInterval(interval);
    };
  }, []);

  return (
    <DraggablePanel id="agents" title="Agents" width={300}>
      {agents.length === 0 ? (
        <div style={{ fontSize: 12, opacity: 0.6 }}>No agents connected yet.</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {agents.map(a => (
            <div
              key={a.client_id}
              style={{
                background: "var(--card)",
                border: "1px solid var(--border)",
                borderRadius: 8,
                padding: "7px 10px",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <div
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: "50%",
                    background: dotColor(a.last_seen),
                    flexShrink: 0,
                  }}
                />
                <span
                  style={{
                    flex: 1,
                    fontSize: 12,
                    fontWeight: 600,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {a.client_id}
                </span>
                <span style={{ fontSize: 10, opacity: 0.5, whiteSpace: "nowrap" }}>
                  {relTime(a.last_seen)}
                </span>
              </div>
              <div style={{ display: "flex", gap: 8, marginTop: 4, fontSize: 11, opacity: 0.7 }}>
                {a.last_tool && (
                  <span>
                    Last: <code>{a.last_tool}</code>
                  </span>
                )}
                <span style={{ marginLeft: "auto" }}>{a.calls_today} calls today</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </DraggablePanel>
  );
}
