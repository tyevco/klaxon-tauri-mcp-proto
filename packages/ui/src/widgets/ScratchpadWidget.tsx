import React, { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { ScratchpadEntry } from "@klaxon/protocol";
import { DraggablePanel } from "../components/DraggablePanel";

function relTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h`;
}

export function ScratchpadWidget() {
  const [entries, setEntries] = useState<ScratchpadEntry[]>([]);
  const [input, setInput] = useState("");
  const [clearing, setClearing] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  async function refresh() {
    try {
      const raw = await invoke<ScratchpadEntry[]>("scratchpad_list", { limit: 100 });
      setEntries(raw ?? []);
    } catch {}
  }

  useEffect(() => {
    refresh();
    const u1 = listen("scratchpad.updated", () => refresh());
    return () => { u1.then(u => u()); };
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [entries]);

  async function send() {
    const content = input.trim();
    if (!content) return;
    setInput("");
    try {
      await invoke("scratchpad_add", { content });
    } catch {}
  }

  async function clearAll() {
    if (!window.confirm("Clear all scratchpad entries?")) return;
    setClearing(true);
    try {
      await invoke("scratchpad_clear");
      setEntries([]);
    } finally {
      setClearing(false);
    }
  }

  return (
    <DraggablePanel id="scratchpad" title="Scratchpad" width={340}>
      <div style={{ display: "flex", flexDirection: "column", height: 460 }}>
        <div style={{ flex: 1, overflowY: "auto", marginBottom: 8, display: "flex", flexDirection: "column", gap: 6 }}>
          {entries.length === 0 ? (
            <div style={{ fontSize: 12, opacity: 0.45, textAlign: "center", marginTop: 40 }}>
              No notes yet. Add one below or have an agent write via scratchpad.write.
            </div>
          ) : entries.map(e => (
            <div
              key={e.id}
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: e.author === "user" ? "flex-end" : "flex-start",
              }}
            >
              <div
                style={{
                  maxWidth: "80%", padding: "6px 10px", borderRadius: 10,
                  background: e.author === "user" ? "var(--info)" : "var(--card)",
                  border: e.author === "user" ? "none" : "1px solid var(--border)",
                  color: e.author === "user" ? "#fff" : "var(--text)",
                  fontSize: 12, lineHeight: 1.4,
                  borderBottomRightRadius: e.author === "user" ? 2 : 10,
                  borderBottomLeftRadius: e.author === "user" ? 10 : 2,
                }}
              >
                {e.content}
              </div>
              <div style={{ fontSize: 9, opacity: 0.4, marginTop: 2 }}>
                {e.author} · {relTime(e.created_at)} ago
              </div>
            </div>
          ))}
          <div ref={bottomRef} />
        </div>

        <div style={{ display: "flex", gap: 6 }}>
          <input
            type="text"
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") send(); }}
            placeholder="Add a note…"
            style={{
              flex: 1, background: "var(--card)", border: "1px solid var(--border)",
              borderRadius: 8, padding: "6px 10px", color: "var(--text)", fontSize: 12,
            }}
          />
          <button
            onClick={send}
            style={{
              padding: "6px 12px", borderRadius: 8, cursor: "pointer",
              background: "var(--info)", border: "none", color: "#fff", fontSize: 12,
            }}
          >
            Send
          </button>
        </div>

        <button
          onClick={clearAll}
          disabled={clearing || entries.length === 0}
          style={{
            marginTop: 6, fontSize: 11, padding: "3px 8px", borderRadius: 6,
            cursor: "pointer", background: "var(--card)", border: "1px solid var(--border)",
            color: "var(--text)", opacity: entries.length === 0 ? 0.4 : 0.7,
          }}
        >
          Clear all
        </button>
      </div>
    </DraggablePanel>
  );
}
