import React, { useCallback, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Checkpoint } from "@klaxon/protocol";
import { DraggablePanel } from "../components/DraggablePanel";
import { relTime } from "../utils";
import { useTauriEvent } from "../hooks/useTauriEvent";

export function CheckpointWidget() {
  const [checkpoints, setCheckpoints] = useState<Checkpoint[]>([]);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [sessionFilter, setSessionFilter] = useState("");

  const refresh = useCallback(async () => {
    try {
      const raw = await invoke<Checkpoint[]>("checkpoints_list", { limit: 100 });
      setCheckpoints(raw ?? []);
    } catch (err) {
      console.error("[CheckpointWidget] refresh failed:", err);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useTauriEvent("checkpoints.updated", refresh);

  const clearAll = useCallback(async () => {
    const tag = sessionFilter.trim() || null;
    if (!window.confirm(tag ? `Clear checkpoints for "${tag}"?` : "Clear all checkpoints?")) return;
    try {
      await invoke("checkpoints_clear", { sessionTag: tag });
    } catch (err) {
      console.error("[CheckpointWidget] clear failed:", err);
    }
  }, [sessionFilter]);

  const sessions = useMemo(
    () => [...new Set(checkpoints.map(c => c.session_tag).filter(Boolean) as string[])],
    [checkpoints],
  );

  const filtered = useMemo(
    () => (sessionFilter ? checkpoints.filter(c => c.session_tag === sessionFilter) : checkpoints),
    [checkpoints, sessionFilter],
  );

  const latestPct = useMemo(
    () => filtered.find(c => c.progress_pct != null)?.progress_pct ?? null,
    [filtered],
  );

  return (
    <DraggablePanel id="checkpoints" title="Checkpoints" width={420}>
      {sessions.length > 1 && (
        <div style={{ display: "flex", gap: 4, marginBottom: 8, flexWrap: "wrap" }}>
          <button
            onClick={() => setSessionFilter("")}
            style={{
              fontSize: 10,
              padding: "2px 8px",
              borderRadius: 10,
              cursor: "pointer",
              background: !sessionFilter ? "var(--info)" : "var(--card)",
              border: `1px solid ${!sessionFilter ? "var(--info)" : "var(--border)"}`,
              color: !sessionFilter ? "#fff" : "var(--text)",
            }}
          >
            All
          </button>
          {sessions.map(s => (
            <button
              key={s}
              onClick={() => setSessionFilter(s)}
              style={{
                fontSize: 10,
                padding: "2px 8px",
                borderRadius: 10,
                cursor: "pointer",
                background: sessionFilter === s ? "var(--info)" : "var(--card)",
                border: `1px solid ${sessionFilter === s ? "var(--info)" : "var(--border)"}`,
                color: sessionFilter === s ? "#fff" : "var(--text)",
              }}
            >
              {s}
            </button>
          ))}
        </div>
      )}

      {latestPct != null && (
        <div style={{ marginBottom: 12 }}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              fontSize: 11,
              marginBottom: 3,
              opacity: 0.7,
            }}
          >
            <span>Overall progress</span>
            <span>{latestPct}%</span>
          </div>
          <div
            style={{ height: 6, background: "var(--border)", borderRadius: 3, overflow: "hidden" }}
          >
            <div
              style={{
                height: "100%",
                width: `${latestPct}%`,
                background: latestPct >= 100 ? "var(--ok)" : "var(--info)",
                borderRadius: 3,
                transition: "width 0.3s ease",
              }}
            />
          </div>
        </div>
      )}

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 0,
          overflowY: "auto",
          maxHeight: 360,
          position: "relative",
        }}
      >
        {filtered.length === 0 ? (
          <div style={{ fontSize: 12, opacity: 0.45 }}>No checkpoints yet.</div>
        ) : (
          filtered.map((cp, i) => (
            <CheckpointRow
              key={cp.id}
              checkpoint={cp}
              isLatest={i === 0}
              isLast={i === filtered.length - 1}
              isExpanded={expanded === cp.id}
              onToggle={() =>
                cp.detail && setExpanded(expanded === cp.id ? null : cp.id)
              }
            />
          ))
        )}
      </div>

      <button
        onClick={clearAll}
        disabled={filtered.length === 0}
        style={{
          marginTop: 10,
          fontSize: 11,
          padding: "3px 8px",
          borderRadius: 6,
          cursor: "pointer",
          background: "var(--card)",
          border: "1px solid var(--border)",
          color: "var(--text)",
          opacity: filtered.length === 0 ? 0.4 : 0.7,
        }}
      >
        Clear {sessionFilter ? `"${sessionFilter}"` : "all"}
      </button>
    </DraggablePanel>
  );
}

const CheckpointRow = React.memo(function CheckpointRow({
  checkpoint: cp,
  isLatest,
  isLast,
  isExpanded,
  onToggle,
}: {
  checkpoint: Checkpoint;
  isLatest: boolean;
  isLast: boolean;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  return (
    <div style={{ display: "flex", gap: 10 }}>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          width: 20,
          flexShrink: 0,
        }}
      >
        <div
          style={{
            width: 14,
            height: 14,
            borderRadius: "50%",
            flexShrink: 0,
            background: isLatest ? "var(--info)" : "var(--ok)",
            border: isLatest ? "2px solid var(--text)" : "none",
            marginTop: 8,
          }}
        />
        {!isLast && (
          <div style={{ width: 2, flex: 1, background: "var(--border)", marginTop: 2 }} />
        )}
      </div>
      <div
        style={{
          flex: 1,
          padding: "7px 0 10px",
          cursor: cp.detail ? "pointer" : "default",
        }}
        onClick={onToggle}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ flex: 1, fontSize: 12, fontWeight: isLatest ? 700 : 500 }}>
            {cp.label}
          </span>
          {cp.progress_pct != null && (
            <span style={{ fontSize: 10, opacity: 0.55 }}>{cp.progress_pct}%</span>
          )}
          <span style={{ fontSize: 10, opacity: 0.45 }}>{relTime(cp.created_at)}</span>
        </div>
        {isExpanded && cp.detail && (
          <div style={{ marginTop: 4, fontSize: 11, opacity: 0.7 }}>{cp.detail}</div>
        )}
        {!isExpanded && cp.detail && (
          <div style={{ fontSize: 11, opacity: 0.5, marginTop: 2 }}>{cp.detail}</div>
        )}
      </div>
    </div>
  );
});
