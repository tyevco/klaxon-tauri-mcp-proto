import React, { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { WorkItem } from "@klaxon/protocol";
import { DraggablePanel } from "../components/DraggablePanel";

const STATUS_COLORS: Record<string, string> = {
  pending:   "var(--warn)",
  active:    "var(--info)",
  done:      "var(--ok)",
  cancelled: "var(--muted)",
};

function relTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  return `${Math.floor(m / 60)}h ago`;
}

const STATUSES = ["pending", "active", "done", "cancelled"];

export function QueueWidget() {
  const [items, setItems] = useState<WorkItem[]>([]);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [statusFilter, setStatusFilter] = useState("all");

  async function refresh() {
    try {
      const raw = await invoke<WorkItem[]>("queue_list");
      setItems(raw ?? []);
    } catch {}
  }

  useEffect(() => {
    refresh();
    const u1 = listen("queue.updated", () => refresh());
    return () => { u1.then(u => u()); };
  }, []);

  async function updateStatus(id: number, status: string) {
    try {
      await invoke("queue_update", { id, status });
    } catch {}
  }

  async function cancelAll() {
    if (!window.confirm("Cancel all pending items?")) return;
    try {
      await invoke("queue_cancel_pending");
    } catch {}
  }

  const filtered = statusFilter === "all" ? items : items.filter(i => i.status === statusFilter);
  const pending = items.filter(i => i.status === "pending").length;
  const active  = items.filter(i => i.status === "active").length;

  return (
    <DraggablePanel id="queue" title="Work Queue" width={540}>
      <div style={{ display: "flex", gap: 6, marginBottom: 8, alignItems: "center", flexWrap: "wrap" }}>
        <div style={{ display: "flex", gap: 4 }}>
          {[["all", "All"], ["pending", `Pending (${pending})`], ["active", `Active (${active})`], ["done", "Done"]].map(([v, label]) => (
            <button
              key={v}
              onClick={() => setStatusFilter(v)}
              style={{
                fontSize: 10, padding: "2px 8px", borderRadius: 10, cursor: "pointer",
                background: statusFilter === v ? "var(--info)" : "var(--card)",
                border: `1px solid ${statusFilter === v ? "var(--info)" : "var(--border)"}`,
                color: statusFilter === v ? "#fff" : "var(--text)",
              }}
            >
              {label}
            </button>
          ))}
        </div>
        {pending > 0 && (
          <button
            onClick={cancelAll}
            style={{
              marginLeft: "auto", fontSize: 10, padding: "2px 8px", borderRadius: 6, cursor: "pointer",
              background: "none", border: "1px solid var(--danger)", color: "var(--danger)",
            }}
          >
            Cancel all pending
          </button>
        )}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 4, overflowY: "auto", maxHeight: 480 }}>
        {filtered.length === 0 ? (
          <div style={{ fontSize: 12, opacity: 0.45 }}>
            {statusFilter === "all" ? "Queue is empty." : `No ${statusFilter} items.`}
          </div>
        ) : filtered.map(item => {
          const isExpanded = expanded === item.id;
          return (
            <div
              key={item.id}
              style={{
                background: "var(--card)", border: "1px solid var(--border)", borderRadius: 8,
                padding: "7px 10px",
                borderLeft: `3px solid ${STATUS_COLORS[item.status] ?? "var(--border)"}`,
                opacity: item.status === "cancelled" ? 0.5 : 1,
              }}
            >
              <div
                style={{ cursor: "pointer" }}
                onClick={() => setExpanded(isExpanded ? null : item.id)}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ flex: 1, fontSize: 12, fontWeight: 600 }}>{item.title}</span>
                  <span style={{
                    fontSize: 9, padding: "1px 6px", borderRadius: 10,
                    background: STATUS_COLORS[item.status] ?? "var(--border)",
                    color: ["done", "active"].includes(item.status) ? "#fff" : "var(--text)",
                  }}>
                    {item.status}
                  </span>
                  <span style={{ fontSize: 10, opacity: 0.4 }}>{relTime(item.updated_at)}</span>
                </div>
                {item.detail && !isExpanded && (
                  <div style={{ fontSize: 11, opacity: 0.6, marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {item.detail}
                  </div>
                )}
              </div>

              {isExpanded && (
                <div style={{ marginTop: 8, fontSize: 12 }}>
                  {item.detail && (
                    <div style={{ opacity: 0.75, marginBottom: 8, whiteSpace: "pre-wrap" }}>{item.detail}</div>
                  )}
                  <div style={{ display: "flex", gap: 4, fontSize: 11, opacity: 0.6, marginBottom: 6 }}>
                    {item.agent_id && <span>Agent: <code>{item.agent_id}</code></span>}
                    <span>Priority: {item.priority}</span>
                  </div>
                  <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                    {STATUSES.filter(s => s !== item.status).map(s => (
                      <button
                        key={s}
                        onClick={() => updateStatus(item.id, s)}
                        style={{
                          fontSize: 11, padding: "3px 8px", borderRadius: 6, cursor: "pointer",
                          background: "var(--bg)", border: `1px solid ${STATUS_COLORS[s] ?? "var(--border)"}`,
                          color: STATUS_COLORS[s] ?? "var(--text)",
                        }}
                      >
                        → {s}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </DraggablePanel>
  );
}
