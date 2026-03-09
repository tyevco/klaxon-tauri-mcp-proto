import React, { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ScratchpadEntry } from "@klaxon/protocol";
import { DraggablePanel } from "../components/DraggablePanel";
import { useTauriEvent } from "../hooks/useTauriEvent";

function relTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h`;
}

const SEND_BTN_STYLE: React.CSSProperties = {
  padding: "6px 12px",
  borderRadius: 8,
  cursor: "pointer",
  background: "var(--info)",
  border: "none",
  color: "#fff",
  fontSize: 12,
};

const INPUT_STYLE: React.CSSProperties = {
  flex: 1,
  background: "var(--card)",
  border: "1px solid var(--border)",
  borderRadius: 8,
  padding: "6px 10px",
  color: "var(--text)",
  fontSize: 12,
};

const CLEAR_BTN_STYLE: React.CSSProperties = {
  marginTop: 6,
  fontSize: 11,
  padding: "3px 8px",
  borderRadius: 6,
  cursor: "pointer",
  background: "var(--card)",
  border: "1px solid var(--border)",
  color: "var(--text)",
};

export function ScratchpadWidget() {
  const [entries, setEntries] = useState<ScratchpadEntry[]>([]);
  const [input, setInput] = useState("");
  const [clearing, setClearing] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const refresh = useCallback(async () => {
    try {
      const raw = await invoke<ScratchpadEntry[]>("scratchpad_list", { limit: 100 });
      setEntries(raw ?? []);
    } catch (err) {
      console.error("[ScratchpadWidget] refresh failed:", err);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useTauriEvent("scratchpad.updated", refresh);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [entries]);

  const send = useCallback(async () => {
    const content = input.trim();
    if (!content) return;
    setInput("");
    try {
      await invoke("scratchpad_add", { content });
    } catch (err) {
      console.error("[ScratchpadWidget] send failed:", err);
    }
  }, [input]);

  const clearAll = useCallback(async () => {
    if (!window.confirm("Clear all scratchpad entries?")) return;
    setClearing(true);
    try {
      await invoke("scratchpad_clear");
      setEntries([]);
    } catch (err) {
      console.error("[ScratchpadWidget] clear failed:", err);
    } finally {
      setClearing(false);
    }
  }, []);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") send();
    },
    [send],
  );

  return (
    <DraggablePanel id="scratchpad" title="Scratchpad" width={340}>
      <div style={{ display: "flex", flexDirection: "column", height: 460 }}>
        <div
          style={{
            flex: 1,
            overflowY: "auto",
            marginBottom: 8,
            display: "flex",
            flexDirection: "column",
            gap: 6,
          }}
        >
          {entries.length === 0 ? (
            <div style={{ fontSize: 12, opacity: 0.45, textAlign: "center", marginTop: 40 }}>
              No notes yet. Add one below or have an agent write via scratchpad.write.
            </div>
          ) : (
            entries.map(e => <ScratchpadMessage key={e.id} entry={e} />)
          )}
          <div ref={bottomRef} />
        </div>

        <div style={{ display: "flex", gap: 6 }}>
          <input
            type="text"
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Add a note…"
            style={INPUT_STYLE}
          />
          <button onClick={send} style={SEND_BTN_STYLE}>
            Send
          </button>
        </div>

        <button
          onClick={clearAll}
          disabled={clearing || entries.length === 0}
          style={{ ...CLEAR_BTN_STYLE, opacity: entries.length === 0 ? 0.4 : 0.7 }}
        >
          Clear all
        </button>
      </div>
    </DraggablePanel>
  );
}

const ScratchpadMessage = React.memo(function ScratchpadMessage({
  entry: e,
}: {
  entry: ScratchpadEntry;
}) {
  const isUser = e.author === "user";
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: isUser ? "flex-end" : "flex-start",
      }}
    >
      <div
        style={{
          maxWidth: "80%",
          padding: "6px 10px",
          borderRadius: 10,
          background: isUser ? "var(--info)" : "var(--card)",
          border: isUser ? "none" : "1px solid var(--border)",
          color: isUser ? "#fff" : "var(--text)",
          fontSize: 12,
          lineHeight: 1.4,
          borderBottomRightRadius: isUser ? 2 : 10,
          borderBottomLeftRadius: isUser ? 10 : 2,
        }}
      >
        {e.content}
      </div>
      <div style={{ fontSize: 9, opacity: 0.4, marginTop: 2 }}>
        {e.author} · {relTime(e.created_at)} ago
      </div>
    </div>
  );
});
