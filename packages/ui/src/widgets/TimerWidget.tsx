import React, { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { IssueSummary } from "@klaxon/protocol";
import { DraggablePanel } from "../components/DraggablePanel";
import { fmtSeconds } from "../utils";

export function TimerWidget() {
  const [today, setToday] = useState<IssueSummary[]>([]);
  const [input, setInput] = useState("");
  const [, setTick] = useState(0);

  async function refresh() {
    const raw = await invoke<IssueSummary[]>("timer_today");
    setToday(raw ?? []);
  }

  useEffect(() => {
    refresh();
    const unsub = listen("timer.updated", () => refresh());
    return () => {
      unsub.then(u => u());
    };
  }, []);

  // Tick every second while any timer is active.
  useEffect(() => {
    const hasActive = today.some(s => s.active_since != null);
    if (!hasActive) return;
    const id = setInterval(() => setTick(t => t + 1), 1000);
    return () => clearInterval(id);
  }, [today.some(s => s.active_since != null)]);

  async function handleStart() {
    const issue = input.trim();
    if (!issue) return;
    await invoke("timer_start", { issueId: issue });
    setInput("");
    refresh();
  }

  async function handleToggle(issueId: string, isActive: boolean) {
    if (isActive) {
      await invoke("timer_stop", { issueId });
    } else {
      await invoke("timer_start", { issueId });
    }
    refresh();
  }

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
                  <button onClick={() => handleToggle(s.issue_id, isActive)} style={iconBtnStyle()}>
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
            style={inputStyle()}
            placeholder="PROJ-123"
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => {
              if (e.key === "Enter") handleStart();
            }}
          />
          <button onClick={handleStart} style={btnStyle()}>
            Start
          </button>
        </div>
      </div>
    </DraggablePanel>
  );
}

function iconBtnStyle(): React.CSSProperties {
  return {
    background: "transparent",
    border: "none",
    color: "var(--text)",
    cursor: "pointer",
    fontSize: 12,
    padding: "2px 4px",
    opacity: 0.8,
    lineHeight: 1,
  };
}

function btnStyle(): React.CSSProperties {
  return {
    background: "transparent",
    border: "1px solid var(--border)",
    color: "var(--text)",
    borderRadius: 10,
    padding: "6px 10px",
    fontSize: 12,
    cursor: "pointer",
  };
}

function inputStyle(): React.CSSProperties {
  return {
    flex: 1,
    borderRadius: 10,
    border: "1px solid var(--border)",
    background: "rgba(0,0,0,0.18)",
    color: "var(--text)",
    padding: "6px 10px",
    fontSize: 13,
  };
}
