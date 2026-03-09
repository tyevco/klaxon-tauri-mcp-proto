import React, { useCallback, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { WorkItem } from "@klaxon/protocol";
import { DraggablePanel } from "../components/DraggablePanel";
import { relTime } from "../utils";
import { useTauriEvent } from "../hooks/useTauriEvent";

const STATUS_COLORS: Record<string, string> = {
  pending: "var(--warn)",
  active: "var(--info)",
  done: "var(--ok)",
  cancelled: "var(--muted)",
};

const STATUSES = ["pending", "active", "done", "cancelled"];

export function QueueWidget() {
  const [items, setItems] = useState<WorkItem[]>([]);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [statusFilter, setStatusFilter] = useState("all");

  const refresh = useCallback(async () => {
    try {
      const raw = await invoke<WorkItem[]>("queue_list");
      setItems(raw ?? []);
    } catch (err) {
      console.error("[QueueWidget] refresh failed:", err);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useTauriEvent("queue.updated", refresh);

  const updateStatus = useCallback(async (id: number, status: string) => {
    try {
      await invoke("queue_update", { id, status });
    } catch (err) {
      console.error("[QueueWidget] updateStatus failed:", err);
    }
  }, []);

  const cancelAll = useCallback(async () => {
    if (!window.confirm("Cancel all pending items?")) return;
    try {
      await invoke("queue_cancel_pending");
    } catch (err) {
      console.error("[QueueWidget] cancelAll failed:", err);
    }
  }, []);

  const filtered = useMemo(
    () => (statusFilter === "all" ? items : items.filter(i => i.status === statusFilter)),
    [items, statusFilter],
  );
  const pending = useMemo(() => items.filter(i => i.status === "pending").length, [items]);
  const active = useMemo(() => items.filter(i => i.status === "active").length, [items]);

  const filterOptions = useMemo(
    () => [
      ["all", "All"],
      ["pending", `Pending (${pending})`],
      ["active", `Active (${active})`],
      ["done", "Done"],
    ] as const,
    [pending, active],
  );

  return (
    <DraggablePanel id="queue" title="Work Queue" width={540}>
      <div
        style={{ display: "flex", gap: 6, marginBottom: 8, alignItems: "center", flexWrap: "wrap" }}
      >
        <div style={{ display: "flex", gap: 4 }}>
          {filterOptions.map(([v, label]) => (
            <button
              key={v}
              onClick={() => setStatusFilter(v)}
              style={{
                fontSize: 10,
                padding: "2px 8px",
                borderRadius: 10,
                cursor: "pointer",
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
              marginLeft: "auto",
              fontSize: 10,
              padding: "2px 8px",
              borderRadius: 6,
              cursor: "pointer",
              background: "none",
              border: "1px solid var(--danger)",
              color: "var(--danger)",
            }}
          >
            Cancel all pending
          </button>
        )}
      </div>

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 4,
          overflowY: "auto",
          maxHeight: 480,
        }}
      >
        {filtered.length === 0 ? (
          <div style={{ fontSize: 12, opacity: 0.45 }}>
            {statusFilter === "all" ? "Queue is empty." : `No ${statusFilter} items.`}
          </div>
        ) : (
          filtered.map(item => (
            <QueueItemCard
              key={item.id}
              item={item}
              isExpanded={expanded === item.id}
              onToggle={() => setExpanded(expanded === item.id ? null : item.id)}
              onUpdateStatus={updateStatus}
            />
          ))
        )}
      </div>
    </DraggablePanel>
  );
}

const QueueItemCard = React.memo(function QueueItemCard({
  item,
  isExpanded,
  onToggle,
  onUpdateStatus,
}: {
  item: WorkItem;
  isExpanded: boolean;
  onToggle: () => void;
  onUpdateStatus: (id: number, status: string) => void;
}) {
  return (
    <div
      style={{
        background: "var(--card)",
        border: "1px solid var(--border)",
        borderRadius: 8,
        padding: "7px 10px",
        borderLeft: `3px solid ${STATUS_COLORS[item.status] ?? "var(--border)"}`,
        opacity: item.status === "cancelled" ? 0.5 : 1,
      }}
    >
      <div style={{ cursor: "pointer" }} onClick={onToggle}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ flex: 1, fontSize: 12, fontWeight: 600 }}>{item.title}</span>
          <span
            style={{
              fontSize: 9,
              padding: "1px 6px",
              borderRadius: 10,
              background: STATUS_COLORS[item.status] ?? "var(--border)",
              color: ["done", "active"].includes(item.status) ? "#fff" : "var(--text)",
            }}
          >
            {item.status}
          </span>
          <span style={{ fontSize: 10, opacity: 0.4 }}>{relTime(item.updated_at)}</span>
        </div>
        {item.detail && !isExpanded && (
          <div
            style={{
              fontSize: 11,
              opacity: 0.6,
              marginTop: 2,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {item.detail}
          </div>
        )}
      </div>

      {isExpanded && (
        <div style={{ marginTop: 8, fontSize: 12 }}>
          {item.detail && (
            <div style={{ opacity: 0.75, marginBottom: 8, whiteSpace: "pre-wrap" }}>
              {item.detail}
            </div>
          )}
          <div
            style={{
              display: "flex",
              gap: 4,
              fontSize: 11,
              opacity: 0.6,
              marginBottom: 6,
            }}
          >
            {item.agent_id && (
              <span>
                Agent: <code>{item.agent_id}</code>
              </span>
            )}
            <span>Priority: {item.priority}</span>
          </div>
          <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
            {STATUSES.filter(s => s !== item.status).map(s => (
              <button
                key={s}
                onClick={() => onUpdateStatus(item.id, s)}
                style={{
                  fontSize: 11,
                  padding: "3px 8px",
                  borderRadius: 6,
                  cursor: "pointer",
                  background: "var(--bg)",
                  border: `1px solid ${STATUS_COLORS[s] ?? "var(--border)"}`,
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
});
