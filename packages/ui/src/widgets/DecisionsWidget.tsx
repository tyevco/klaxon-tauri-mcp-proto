import React, { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { KlaxonItem } from "@klaxon/protocol";
import { DraggablePanel } from "../components/DraggablePanel";

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

function responsePreview(response: unknown): string {
  if (!response || typeof response !== "object") return String(response ?? "");
  const entries = Object.entries(response as Record<string, unknown>);
  if (entries.length === 0) return "{}";
  return entries.slice(0, 3).map(([k, v]) => {
    const val = typeof v === "boolean" ? (v ? "✓" : "✗") : String(v);
    return `${k}: ${val}`;
  }).join(" · ");
}

export function DecisionsWidget() {
  const [items, setItems] = useState<KlaxonItem[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [todayOnly, setTodayOnly] = useState(false);
  const [filterText, setFilterText] = useState("");

  async function refresh() {
    try {
      const raw = await invoke<KlaxonItem[]>("klaxon_list_answered", { limit: 100 });
      setItems(raw ?? []);
    } catch {}
  }

  useEffect(() => {
    refresh();
    const u1 = listen("klaxon.answered", () => refresh());
    const u2 = listen("klaxon.updated", () => refresh());
    return () => { u1.then(u => u()); u2.then(u => u()); };
  }, []);

  const today = new Date().toISOString().slice(0, 10);
  const filtered = items.filter(it => {
    if (todayOnly) {
      const answeredAt = (it as any).answered_at ?? it.created_at;
      if (!answeredAt.startsWith(today)) return false;
    }
    if (filterText) {
      const q = filterText.toLowerCase();
      if (!it.title.toLowerCase().includes(q) && !(it.message ?? "").toLowerCase().includes(q)) return false;
    }
    return true;
  });

  return (
    <DraggablePanel id="decisions" title="Decisions" width={480}>
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
        <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12, cursor: "pointer" }}>
          <input type="checkbox" checked={todayOnly} onChange={e => setTodayOnly(e.target.checked)} />
          Today
        </label>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 4, overflowY: "auto", maxHeight: 480 }}>
        {filtered.length === 0 ? (
          <div style={{ fontSize: 12, opacity: 0.5 }}>No answered decisions yet.</div>
        ) : filtered.map(it => {
          const answeredAt = (it as any).answered_at;
          const isExpanded = expanded === it.id;
          return (
            <div
              key={it.id}
              style={{
                background: "var(--card)", border: "1px solid var(--border)", borderRadius: 8,
                padding: "7px 10px", cursor: "pointer",
                borderLeft: "3px solid var(--ok)",
              }}
              onClick={() => setExpanded(isExpanded ? null : it.id)}
            >
              <div style={{ display: "flex", alignItems: "flex-start", gap: 6 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, fontSize: 12, marginBottom: 2 }}>{it.title}</div>
                  {(it as any).response && (
                    <div style={{ fontSize: 11, opacity: 0.7, fontFamily: "monospace" }}>
                      {responsePreview((it as any).response)}
                    </div>
                  )}
                </div>
                <span style={{ fontSize: 10, opacity: 0.5, whiteSpace: "nowrap", flexShrink: 0 }}>
                  {answeredAt ? relTime(answeredAt) : ""}
                </span>
              </div>
              {isExpanded && (
                <div style={{ marginTop: 8, fontSize: 12 }}>
                  {it.message && (
                    <div style={{ opacity: 0.75, marginBottom: 6, whiteSpace: "pre-wrap" }}>{it.message}</div>
                  )}
                  {it.form && (
                    <div style={{ opacity: 0.6, fontSize: 11, marginBottom: 4 }}>Form: {it.form.title}</div>
                  )}
                  {(it as any).response && (
                    <div style={{ padding: "6px 8px", background: "var(--bg)", borderRadius: 6, fontSize: 11 }}>
                      <div style={{ opacity: 0.5, marginBottom: 3 }}>Response</div>
                      <pre style={{ margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-all" }}>
                        {JSON.stringify((it as any).response, null, 2)}
                      </pre>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </DraggablePanel>
  );
}
