import React, { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { KlaxonItem } from "@klaxon/protocol";
import { DraggablePanel } from "../components/DraggablePanel";

const LEVEL_COLORS: Record<string, string> = {
  info: "var(--info)",
  warning: "var(--warn)",
  error: "var(--danger)",
  success: "var(--ok)",
};

function relTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export function HistoryWidget() {
  const [items, setItems] = useState<KlaxonItem[]>([]);
  const [filterText, setFilterText] = useState("");
  const [filterStatus, setFilterStatus] = useState("all");
  const [todayOnly, setTodayOnly] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  async function refresh() {
    try {
      const raw = await invoke<KlaxonItem[]>("klaxon_list_all", { limit: 200, offset: 0 });
      setItems(raw ?? []);
    } catch {}
  }

  useEffect(() => {
    refresh();
    const u1 = listen("klaxon.created", () => refresh());
    const u2 = listen("klaxon.updated", () => refresh());
    return () => { u1.then(u => u()); u2.then(u => u()); };
  }, []);

  const today = new Date().toISOString().slice(0, 10);
  const filtered = items.filter(it => {
    if (filterStatus !== "all" && it.status !== filterStatus) return false;
    if (todayOnly && !it.created_at.startsWith(today)) return false;
    if (filterText) {
      const q = filterText.toLowerCase();
      if (!it.title.toLowerCase().includes(q) && !(it.message ?? "").toLowerCase().includes(q)) return false;
    }
    return true;
  });

  return (
    <DraggablePanel id="history" title="History" width={480}>
      <div style={{ display: "flex", gap: 6, marginBottom: 8, flexWrap: "wrap" }}>
        <input
          type="text"
          placeholder="Search..."
          value={filterText}
          onChange={e => setFilterText(e.target.value)}
          style={{
            flex: 1, minWidth: 100, background: "var(--card)", border: "1px solid var(--border)",
            borderRadius: 6, padding: "4px 8px", color: "var(--text)", fontSize: 12,
          }}
        />
        <select
          value={filterStatus}
          onChange={e => setFilterStatus(e.target.value)}
          style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 6, padding: "4px 8px", color: "var(--text)", fontSize: 12 }}
        >
          <option value="all">All</option>
          <option value="open">Open</option>
          <option value="answered">Answered</option>
          <option value="dismissed">Dismissed</option>
          <option value="expired">Expired</option>
        </select>
        <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12, cursor: "pointer" }}>
          <input type="checkbox" checked={todayOnly} onChange={e => setTodayOnly(e.target.checked)} />
          Today
        </label>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 4, overflowY: "auto", maxHeight: 500 }}>
        {filtered.length === 0 ? (
          <div style={{ fontSize: 12, opacity: 0.6 }}>No items.</div>
        ) : filtered.map(it => (
          <div
            key={it.id}
            style={{
              background: "var(--card)", border: "1px solid var(--border)", borderRadius: 8,
              padding: "6px 10px", cursor: "pointer",
              borderLeft: `3px solid ${LEVEL_COLORS[it.level] ?? "var(--border)"}`,
            }}
            onClick={() => setExpanded(expanded === it.id ? null : it.id)}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ flex: 1, fontWeight: 600, fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {it.title}
              </span>
              <span style={{ fontSize: 10, padding: "1px 5px", borderRadius: 10, background: "var(--border)", color: "var(--muted)" }}>
                {it.status}
              </span>
              <span style={{ fontSize: 10, opacity: 0.5, whiteSpace: "nowrap" }}>{relTime(it.created_at)}</span>
            </div>
            {expanded === it.id && (
              <div style={{ marginTop: 6, fontSize: 12, opacity: 0.85 }}>
                {it.message && <div style={{ marginBottom: 4, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{it.message}</div>}
                {it.form && (
                  <div style={{ opacity: 0.7, fontSize: 11 }}>Form: {it.form.title}</div>
                )}
                {(it as any).response && (
                  <div style={{ marginTop: 4, padding: "4px 6px", background: "var(--bg)", borderRadius: 4, fontSize: 11 }}>
                    <span style={{ opacity: 0.6 }}>Response: </span>
                    <code style={{ wordBreak: "break-all" }}>{JSON.stringify((it as any).response, null, 1)}</code>
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </DraggablePanel>
  );
}
