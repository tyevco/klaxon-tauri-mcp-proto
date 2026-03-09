import React, { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { KlaxonItem } from "@klaxon/protocol";
import { DraggablePanel } from "../components/DraggablePanel";
import { relTime } from "../utils";

const LEVEL_COLORS: Record<string, string> = {
  info: "var(--info)",
  warning: "var(--warn)",
  error: "var(--danger)",
  success: "var(--ok)",
};

function responsePreview(response: unknown): string {
  if (!response || typeof response !== "object") return String(response ?? "");
  const entries = Object.entries(response as Record<string, unknown>);
  if (entries.length === 0) return "{}";
  return entries
    .slice(0, 3)
    .map(([k, v]) => {
      const val = typeof v === "boolean" ? (v ? "✓" : "✗") : String(v);
      return `${k}: ${val}`;
    })
    .join(" · ");
}

export function HistoryWidget() {
  const [view, setView] = useState<"all" | "answered">("all");
  const [items, setItems] = useState<KlaxonItem[]>([]);
  const [answered, setAnswered] = useState<KlaxonItem[]>([]);
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

  async function refreshAnswered() {
    try {
      const raw = await invoke<KlaxonItem[]>("klaxon_list_answered", { limit: 100 });
      setAnswered(raw ?? []);
    } catch {}
  }

  useEffect(() => {
    refresh();
    refreshAnswered();
    const u1 = listen("klaxon.created", () => {
      refresh();
      refreshAnswered();
    });
    const u2 = listen("klaxon.updated", () => {
      refresh();
      refreshAnswered();
    });
    const u3 = listen("klaxon.answered", () => refreshAnswered());
    return () => {
      u1.then(u => u());
      u2.then(u => u());
      u3.then(u => u());
    };
  }, []);

  const today = new Date().toISOString().slice(0, 10);

  const filteredAll = items.filter(it => {
    if (filterStatus !== "all" && it.status !== filterStatus) return false;
    if (todayOnly && !it.created_at.startsWith(today)) return false;
    if (filterText) {
      const q = filterText.toLowerCase();
      if (!it.title.toLowerCase().includes(q) && !(it.message ?? "").toLowerCase().includes(q))
        return false;
    }
    return true;
  });

  const filteredAnswered = answered.filter(it => {
    if (todayOnly) {
      const answeredAt = it.answered_at ?? it.created_at;
      if (!answeredAt.startsWith(today)) return false;
    }
    if (filterText) {
      const q = filterText.toLowerCase();
      if (!it.title.toLowerCase().includes(q) && !(it.message ?? "").toLowerCase().includes(q))
        return false;
    }
    return true;
  });

  const tabBtnStyle = (active: boolean): React.CSSProperties => ({
    flex: 1,
    padding: "6px 0",
    fontSize: 12,
    fontWeight: active ? 600 : 400,
    background: active ? "var(--card)" : "transparent",
    border: "none",
    borderBottom: active ? "2px solid var(--info)" : "2px solid transparent",
    color: active ? "var(--text)" : "var(--muted)",
    cursor: "pointer",
  });

  return (
    <DraggablePanel id="history" title="History" width={480}>
      <div style={{ display: "flex", borderBottom: "1px solid var(--border)", marginBottom: 8 }}>
        <button style={tabBtnStyle(view === "all")} onClick={() => setView("all")}>
          All
        </button>
        <button style={tabBtnStyle(view === "answered")} onClick={() => setView("answered")}>
          Answered
        </button>
      </div>

      {view === "all" && (
        <>
          <div style={{ display: "flex", gap: 6, marginBottom: 8, flexWrap: "wrap" }}>
            <input
              type="text"
              placeholder="Search..."
              value={filterText}
              onChange={e => setFilterText(e.target.value)}
              style={{
                flex: 1,
                minWidth: 100,
                background: "var(--card)",
                border: "1px solid var(--border)",
                borderRadius: 6,
                padding: "4px 8px",
                color: "var(--text)",
                fontSize: 12,
              }}
            />
            <select
              value={filterStatus}
              onChange={e => setFilterStatus(e.target.value)}
              style={{
                background: "var(--card)",
                border: "1px solid var(--border)",
                borderRadius: 6,
                padding: "4px 8px",
                color: "var(--text)",
                fontSize: 12,
              }}
            >
              <option value="all">All</option>
              <option value="open">Open</option>
              <option value="answered">Answered</option>
              <option value="dismissed">Dismissed</option>
              <option value="expired">Expired</option>
            </select>
            <label
              style={{
                display: "flex",
                alignItems: "center",
                gap: 4,
                fontSize: 12,
                cursor: "pointer",
              }}
            >
              <input
                type="checkbox"
                checked={todayOnly}
                onChange={e => setTodayOnly(e.target.checked)}
              />
              Today
            </label>
          </div>

          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 4,
              overflowY: "auto",
              maxHeight: 500,
            }}
          >
            {filteredAll.length === 0 ? (
              <div style={{ fontSize: 12, opacity: 0.6 }}>No items.</div>
            ) : (
              filteredAll.map(it => (
                <div
                  key={it.id}
                  style={{
                    background: "var(--card)",
                    border: "1px solid var(--border)",
                    borderRadius: 8,
                    padding: "6px 10px",
                    cursor: "pointer",
                    borderLeft: `3px solid ${LEVEL_COLORS[it.level] ?? "var(--border)"}`,
                  }}
                  onClick={() => setExpanded(expanded === it.id ? null : it.id)}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span
                      style={{
                        flex: 1,
                        fontWeight: 600,
                        fontSize: 12,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {it.title}
                    </span>
                    <span
                      style={{
                        fontSize: 10,
                        padding: "1px 5px",
                        borderRadius: 10,
                        background: "var(--border)",
                        color: "var(--muted)",
                      }}
                    >
                      {it.status}
                    </span>
                    <span style={{ fontSize: 10, opacity: 0.5, whiteSpace: "nowrap" }}>
                      {relTime(it.created_at)}
                    </span>
                  </div>
                  {expanded === it.id && (
                    <div style={{ marginTop: 6, fontSize: 12, opacity: 0.85 }}>
                      {it.message && (
                        <div
                          style={{
                            marginBottom: 4,
                            whiteSpace: "pre-wrap",
                            wordBreak: "break-word",
                          }}
                        >
                          {it.message}
                        </div>
                      )}
                      {it.form && (
                        <div style={{ opacity: 0.7, fontSize: 11 }}>Form: {it.form.title}</div>
                      )}
                      {it.response && (
                        <div
                          style={{
                            marginTop: 4,
                            padding: "4px 6px",
                            background: "var(--bg)",
                            borderRadius: 4,
                            fontSize: 11,
                          }}
                        >
                          <span style={{ opacity: 0.6 }}>Response: </span>
                          <code style={{ wordBreak: "break-all" }}>
                            {JSON.stringify(it.response, null, 1)}
                          </code>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </>
      )}

      {view === "answered" && (
        <>
          <div style={{ display: "flex", gap: 6, marginBottom: 8, flexWrap: "wrap" }}>
            <input
              type="text"
              placeholder="Search..."
              value={filterText}
              onChange={e => setFilterText(e.target.value)}
              style={{
                flex: 1,
                minWidth: 100,
                background: "var(--card)",
                border: "1px solid var(--border)",
                borderRadius: 6,
                padding: "4px 8px",
                color: "var(--text)",
                fontSize: 12,
              }}
            />
            <label
              style={{
                display: "flex",
                alignItems: "center",
                gap: 4,
                fontSize: 12,
                cursor: "pointer",
              }}
            >
              <input
                type="checkbox"
                checked={todayOnly}
                onChange={e => setTodayOnly(e.target.checked)}
              />
              Today
            </label>
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
            {filteredAnswered.length === 0 ? (
              <div style={{ fontSize: 12, opacity: 0.5 }}>No answered decisions yet.</div>
            ) : (
              filteredAnswered.map(it => {
                const answeredAt = it.answered_at;
                const isExpanded = expanded === it.id;
                return (
                  <div
                    key={it.id}
                    style={{
                      background: "var(--card)",
                      border: "1px solid var(--border)",
                      borderRadius: 8,
                      padding: "7px 10px",
                      cursor: "pointer",
                      borderLeft: "3px solid var(--ok)",
                    }}
                    onClick={() => setExpanded(isExpanded ? null : it.id)}
                  >
                    <div style={{ display: "flex", alignItems: "flex-start", gap: 6 }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 600, fontSize: 12, marginBottom: 2 }}>
                          {it.title}
                        </div>
                        {it.response && (
                          <div style={{ fontSize: 11, opacity: 0.7, fontFamily: "monospace" }}>
                            {responsePreview(it.response)}
                          </div>
                        )}
                      </div>
                      <span
                        style={{ fontSize: 10, opacity: 0.5, whiteSpace: "nowrap", flexShrink: 0 }}
                      >
                        {answeredAt ? relTime(answeredAt) : ""}
                      </span>
                    </div>
                    {isExpanded && (
                      <div style={{ marginTop: 8, fontSize: 12 }}>
                        {it.message && (
                          <div style={{ opacity: 0.75, marginBottom: 6, whiteSpace: "pre-wrap" }}>
                            {it.message}
                          </div>
                        )}
                        {it.form && (
                          <div style={{ opacity: 0.6, fontSize: 11, marginBottom: 4 }}>
                            Form: {it.form.title}
                          </div>
                        )}
                        {it.response && (
                          <div
                            style={{
                              padding: "6px 8px",
                              background: "var(--bg)",
                              borderRadius: 6,
                              fontSize: 11,
                            }}
                          >
                            <div style={{ opacity: 0.5, marginBottom: 3 }}>Response</div>
                            <pre
                              style={{ margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-all" }}
                            >
                              {JSON.stringify(it.response, null, 2)}
                            </pre>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </>
      )}
    </DraggablePanel>
  );
}
