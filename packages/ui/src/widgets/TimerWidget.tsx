import React, { useCallback, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { IssueSummary } from "@klaxon/protocol";
import { DraggablePanel } from "../components/DraggablePanel";
import { fmtSeconds } from "../utils";
import { useTauriEvent } from "../hooks/useTauriEvent";

const ICON_BTN_STYLE: React.CSSProperties = {
  background: "transparent",
  border: "none",
  color: "var(--text)",
  cursor: "pointer",
  fontSize: 12,
  padding: "2px 4px",
  opacity: 0.8,
  lineHeight: 1,
};

const BTN_STYLE: React.CSSProperties = {
  background: "transparent",
  border: "1px solid var(--border)",
  color: "var(--text)",
  borderRadius: 10,
  padding: "6px 10px",
  fontSize: 12,
  cursor: "pointer",
};

const INPUT_STYLE: React.CSSProperties = {
  flex: 1,
  borderRadius: 10,
  border: "1px solid var(--border)",
  background: "rgba(0,0,0,0.18)",
  color: "var(--text)",
  padding: "6px 10px",
  fontSize: 13,
};

export function TimerWidget() {
  const [today, setToday] = useState<IssueSummary[]>([]);
  const [input, setInput] = useState("");
  const [, setTick] = useState(0);

  const refresh = useCallback(async () => {
    try {
      const raw = await invoke<IssueSummary[]>("timer_today");
      setToday(raw ?? []);
    } catch (err) {
      console.error("[TimerWidget] refresh failed:", err);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useTauriEvent("timer.updated", refresh);

  // Tick every second while any timer is active.
  const hasActive = useMemo(() => today.some(s => s.active_since != null), [today]);
  useEffect(() => {
    if (!hasActive) return;
    const id = setInterval(() => setTick(t => t + 1), 1000);
    return () => clearInterval(id);
  }, [hasActive]);

  const handleStart = useCallback(async () => {
    const issue = input.trim();
    if (!issue) return;
    try {
      await invoke("timer_start", { issueId: issue });
    } catch (err) {
      console.error("[TimerWidget] start failed:", err);
    }
    setInput("");
    refresh();
  }, [input, refresh]);

  const handleToggle = useCallback(
    async (issueId: string, isActive: boolean) => {
      try {
        if (isActive) {
          await invoke("timer_stop", { issueId });
        } else {
          await invoke("timer_start", { issueId });
        }
      } catch (err) {
        console.error("[TimerWidget] toggle failed:", err);
      }
      refresh();
    },
    [refresh],
  );

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") handleStart();
    },
    [handleStart],
  );

  return (
    <DraggablePanel id="timer" title="Time Tracker" width={300}>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {today.length === 0 && <div style={{ fontSize: 13, opacity: 0.7 }}>No active timer.</div>}

        {today.length > 0 && (
          <div>
            <div style={{ fontSize: 11, opacity: 0.6, marginBottom: 6 }}>Today</div>
            {today.map(s => {
              const isActive = s.active_since != null;
              const liveSeconds = isActive
                ? s.seconds + Math.floor((Date.now() - new Date(s.active_since!).getTime()) / 1000)
                : s.seconds;
              return (
                <div
                  key={s.issue_id}
                  style={{ display: "flex", alignItems: "center", gap: 6, padding: "3px 0" }}
                >
                  <button onClick={() => handleToggle(s.issue_id, isActive)} style={ICON_BTN_STYLE}>
                    {isActive ? "⏸" : "▶"}
                  </button>
                  <span style={{ flex: 1, fontSize: 13 }}>{s.issue_id}</span>
                  {isActive && (
                    <span
                      style={{
                        fontSize: 10,
                        color: "var(--ok)",
                        fontWeight: 700,
                        letterSpacing: "0.04em",
                      }}
                    >
                      ●
                    </span>
                  )}
                  <span style={{ opacity: 0.8, fontVariantNumeric: "tabular-nums", fontSize: 13 }}>
                    {fmtSeconds(liveSeconds)}
                  </span>
                </div>
              );
            })}
          </div>
        )}

        <div style={{ display: "flex", gap: 6 }}>
          <input
            style={INPUT_STYLE}
            placeholder="PROJ-123"
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={onKeyDown}
          />
          <button onClick={handleStart} style={BTN_STYLE}>
            Start
          </button>
        </div>
      </div>
    </DraggablePanel>
  );
}
