import React, { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { SessionSummary } from "@klaxon/protocol";
import { DraggablePanel } from "../components/DraggablePanel";
import { relTime, fmtUSD } from "../utils";
import { useTauriEvents } from "../hooks/useTauriEvent";

function elapsed(startIso: string): string {
  const s = Math.floor((Date.now() - new Date(startIso).getTime()) / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

const PILL_STYLE: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 5,
  background: "var(--card)",
  border: "1px solid var(--border)",
  borderRadius: 20,
  padding: "4px 10px",
  fontSize: 12,
};

export function SessionWidget() {
  const [summary, setSummary] = useState<SessionSummary | null>(null);
  const [ending, setEnding] = useState(false);
  const [, setTick] = useState(0);

  const refresh = useCallback(async () => {
    try {
      const s = await invoke<SessionSummary>("session_summary");
      setSummary(s);
    } catch (err) {
      console.error("[SessionWidget] refresh failed:", err);
    }
  }, []);

  useEffect(() => {
    refresh();
    const interval = setInterval(() => setTick(t => t + 1), 10000);
    return () => clearInterval(interval);
  }, [refresh]);

  useTauriEvents([
    { event: "klaxon.created", handler: refresh },
    { event: "klaxon.updated", handler: refresh },
    { event: "klaxon.answered", handler: refresh },
    { event: "timer.updated", handler: refresh },
    { event: "tokens.updated", handler: refresh },
  ]);

  const endSession = useCallback(async () => {
    setEnding(true);
    try {
      await invoke("session_end");
      await refresh();
    } catch (err) {
      console.error("[SessionWidget] endSession failed:", err);
    } finally {
      setEnding(false);
    }
  }, [refresh]);

  return (
    <DraggablePanel id="session" title="Session" width={440}>
      {!summary ? (
        <div style={{ fontSize: 12, opacity: 0.5 }}>Loading...</div>
      ) : (
        <>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 14 }}>
            <div style={PILL_STYLE}>
              <span style={{ opacity: summary.open_count > 0 ? 1 : 0.4 }}>
                {summary.open_count > 0 ? "🔔" : "✓"}
              </span>
              <span style={{ fontWeight: summary.open_count > 0 ? 600 : 400 }}>
                {summary.open_count} open klaxon{summary.open_count !== 1 ? "s" : ""}
              </span>
            </div>

            {summary.active_timers.length > 0 ? (
              summary.active_timers.map(t => (
                <div key={t.issue_id} style={{ ...PILL_STYLE, borderColor: "var(--info)" }}>
                  <span>⏱</span>
                  <span>
                    {t.issue_id} ({elapsed(t.start)})
                  </span>
                </div>
              ))
            ) : (
              <div style={{ ...PILL_STYLE, opacity: 0.5 }}>
                <span>⏱</span>
                <span>No active timer</span>
              </div>
            )}

            <div
              style={{
                ...PILL_STYLE,
                borderColor: summary.today_cost > 0 ? "var(--warn)" : "var(--border)",
              }}
            >
              <span>💰</span>
              <span>{fmtUSD(summary.today_cost)} today</span>
            </div>

            {summary.last_decision ? (
              <div style={PILL_STYLE}>
                <span>✅</span>
                <span>Last decision {relTime(summary.last_decision)}</span>
              </div>
            ) : (
              <div style={{ ...PILL_STYLE, opacity: 0.45 }}>
                <span>✅</span>
                <span>No decisions yet</span>
              </div>
            )}
          </div>

          <button
            onClick={endSession}
            disabled={ending}
            style={{
              width: "100%",
              padding: "7px",
              borderRadius: 8,
              cursor: ending ? "default" : "pointer",
              background: ending ? "var(--border)" : "var(--danger)",
              border: "none",
              color: "#fff",
              fontSize: 13,
              fontWeight: 600,
              opacity: ending ? 0.6 : 1,
            }}
          >
            {ending ? "Ending session…" : "End Session"}
          </button>
          <div style={{ fontSize: 10, opacity: 0.45, marginTop: 4, textAlign: "center" }}>
            Stops all timers and dismisses open klaxons
          </div>
        </>
      )}
    </DraggablePanel>
  );
}
