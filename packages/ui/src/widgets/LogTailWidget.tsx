import React, { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { LogLine } from "@klaxon/protocol";
import { DraggablePanel } from "../components/DraggablePanel";

const STREAM_COLORS: Record<string, string> = {
  stderr: "var(--danger)",
  info: "var(--info)",
  stdout: "var(--text)",
};

function streamColor(stream: string): string {
  return STREAM_COLORS[stream] ?? "var(--text)";
}

export function LogTailWidget() {
  const [lines, setLines] = useState<LogLine[]>([]);
  const [autoScroll, setAutoScroll] = useState(true);
  const [streamFilter, setStreamFilter] = useState("");
  const [paused, setPaused] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const pausedRef = useRef(paused);
  pausedRef.current = paused;

  async function refresh() {
    if (pausedRef.current) return;
    try {
      const raw = await invoke<LogLine[]>("logtail_recent", {
        n: 200,
        stream: streamFilter || null,
      });
      setLines(raw ?? []);
    } catch {}
  }

  useEffect(() => {
    refresh();
    const u1 = listen("logtail.updated", () => refresh());
    return () => {
      u1.then(u => u());
    };
  }, [streamFilter]);

  useEffect(() => {
    if (autoScroll) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [lines, autoScroll]);

  const streams = [...new Set(lines.map(l => l.stream))];

  return (
    <DraggablePanel id="logtail" title="Log Tail" width={540}>
      <div
        style={{ display: "flex", gap: 6, marginBottom: 8, alignItems: "center", flexWrap: "wrap" }}
      >
        <div style={{ display: "flex", gap: 4, flex: 1, flexWrap: "wrap" }}>
          <button
            onClick={() => setStreamFilter("")}
            style={{
              fontSize: 10,
              padding: "2px 8px",
              borderRadius: 10,
              cursor: "pointer",
              background: !streamFilter ? "var(--info)" : "var(--card)",
              border: `1px solid ${!streamFilter ? "var(--info)" : "var(--border)"}`,
              color: !streamFilter ? "#fff" : "var(--text)",
            }}
          >
            All
          </button>
          {streams.map(s => (
            <button
              key={s}
              onClick={() => setStreamFilter(s)}
              style={{
                fontSize: 10,
                padding: "2px 8px",
                borderRadius: 10,
                cursor: "pointer",
                background: streamFilter === s ? "var(--info)" : "var(--card)",
                border: `1px solid ${streamFilter === s ? "var(--info)" : "var(--border)"}`,
                color: streamFilter === s ? "#fff" : "var(--text)",
              }}
            >
              {s}
            </button>
          ))}
        </div>
        <label
          style={{ display: "flex", alignItems: "center", gap: 3, fontSize: 11, cursor: "pointer" }}
        >
          <input
            type="checkbox"
            checked={autoScroll}
            onChange={e => setAutoScroll(e.target.checked)}
          />
          Auto-scroll
        </label>
        <button
          onClick={() => setPaused(p => !p)}
          style={{
            fontSize: 11,
            padding: "2px 8px",
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
            await invoke("logtail_clear");
            setLines([]);
          }}
          style={{
            fontSize: 11,
            padding: "2px 8px",
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
          overflowY: "auto",
          maxHeight: 400,
          fontFamily: "monospace",
          fontSize: 11,
          background: "var(--bg)",
          border: "1px solid var(--border)",
          borderRadius: 6,
          padding: "6px 8px",
        }}
      >
        {lines.length === 0 ? (
          <span style={{ opacity: 0.4 }}>
            No log output yet. Agents can stream lines via logtail.append.
          </span>
        ) : (
          lines.map((l, i) => (
            <div key={i} style={{ display: "flex", gap: 8, lineHeight: 1.5 }}>
              <span style={{ opacity: 0.35, flexShrink: 0, fontSize: 10 }}>
                {new Date(l.ts).toLocaleTimeString()}
              </span>
              <span
                style={{
                  opacity: l.stream === "stderr" ? 1 : 0.7,
                  color: streamColor(l.stream),
                  wordBreak: "break-all",
                }}
              >
                {l.line}
              </span>
            </div>
          ))
        )}
        <div ref={bottomRef} />
      </div>
      <div style={{ fontSize: 10, opacity: 0.4, marginTop: 4 }}>{lines.length} lines</div>
    </DraggablePanel>
  );
}
