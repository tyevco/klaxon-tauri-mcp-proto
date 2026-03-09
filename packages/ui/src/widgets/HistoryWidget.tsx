import React, { useCallback, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { KlaxonItem } from "@klaxon/protocol";
import { DraggablePanel } from "../components/DraggablePanel";
import { relTime } from "../utils";
import { useTauriEvents } from "../hooks/useTauriEvent";

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

function tabBtnStyle(active: boolean): React.CSSProperties {
  return {
    flex: 1,
    padding: "6px 0",
    fontSize: 12,
    fontWeight: active ? 600 : 400,
    background: active ? "var(--card)" : "transparent",
    border: "none",
    borderBottom: active ? "2px solid var(--info)" : "2px solid transparent",
    color: active ? "var(--text)" : "var(--muted)",
    cursor: "pointer",
  };
}

const SEARCH_INPUT_STYLE: React.CSSProperties = {
  flex: 1,
  minWidth: 100,
  background: "var(--card)",
  border: "1px solid var(--border)",
  borderRadius: 6,
  padding: "4px 8px",
  color: "var(--text)",
  fontSize: 12,
};

const SELECT_STYLE: React.CSSProperties = {
  background: "var(--card)",
  border: "1px solid var(--border)",
  borderRadius: 6,
  padding: "4px 8px",
  color: "var(--text)",
  fontSize: 12,
};

export function HistoryWidget() {
  const [view, setView] = useState<"all" | "answered">("all");
  const [items, setItems] = useState<KlaxonItem[]>([]);
  const [answered, setAnswered] = useState<KlaxonItem[]>([]);
  const [filterText, setFilterText] = useState("");
  const [filterStatus, setFilterStatus] = useState("all");
  const [todayOnly, setTodayOnly] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const raw = await invoke<KlaxonItem[]>("klaxon_list_all", { limit: 200, offset: 0 });
      setItems(raw ?? []);
    } catch (err) {
      console.error("[HistoryWidget] refresh failed:", err);
    }
  }, []);

  const refreshAnswered = useCallback(async () => {
    try {
      const raw = await invoke<KlaxonItem[]>("klaxon_list_answered", { limit: 100 });
      setAnswered(raw ?? []);
    } catch (err) {
      console.error("[HistoryWidget] refreshAnswered failed:", err);
    }
  }, []);

  const refreshAll = useCallback(() => {
    refresh();
    refreshAnswered();
  }, [refresh, refreshAnswered]);

  useEffect(() => {
    refreshAll();
  }, [refreshAll]);

  useTauriEvents([
    { event: "klaxon.created", handler: refreshAll },
    { event: "klaxon.updated", handler: refreshAll },
    { event: "klaxon.answered", handler: refreshAnswered },
  ]);

  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);

  const filteredAll = useMemo(() => {
    return items.filter(it => {
      if (filterStatus !== "all" && it.status !== filterStatus) return false;
      if (todayOnly && !it.created_at.startsWith(today)) return false;
      if (filterText) {
        const q = filterText.toLowerCase();
        if (!it.title.toLowerCase().includes(q) && !(it.message ?? "").toLowerCase().includes(q))
          return false;
      }
      return true;
    });
  }, [items, filterStatus, todayOnly, today, filterText]);

  const filteredAnswered = useMemo(() => {
    return answered.filter(it => {
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
  }, [answered, todayOnly, today, filterText]);

  const allTabStyle = useMemo(() => tabBtnStyle(view === "all"), [view]);
  const answeredTabStyle = useMemo(() => tabBtnStyle(view === "answered"), [view]);

  return (
    <DraggablePanel id="history" title="History" width={480}>
      <div style={{ display: "flex", borderBottom: "1px solid var(--border)", marginBottom: 8 }}>
        <button style={allTabStyle} onClick={() => setView("all")}>
          All
        </button>
        <button style={answeredTabStyle} onClick={() => setView("answered")}>
          Answered
        </button>
      </div>

      <div style={{ display: "flex", gap: 6, marginBottom: 8, flexWrap: "wrap" }}>
        <input
          type="text"
          placeholder="Search..."
          value={filterText}
          onChange={e => setFilterText(e.target.value)}
          style={SEARCH_INPUT_STYLE}
        />
        {view === "all" && (
          <select
            value={filterStatus}
            onChange={e => setFilterStatus(e.target.value)}
            style={SELECT_STYLE}
          >
            <option value="all">All</option>
            <option value="open">Open</option>
            <option value="answered">Answered</option>
            <option value="dismissed">Dismissed</option>
            <option value="expired">Expired</option>
          </select>
        )}
        <label
          style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12, cursor: "pointer" }}
        >
          <input
            type="checkbox"
            checked={todayOnly}
            onChange={e => setTodayOnly(e.target.checked)}
          />
          Today
        </label>
      </div>

      {view === "all" && (
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
              <HistoryAllCard
                key={it.id}
                item={it}
                isExpanded={expanded === it.id}
                onToggle={() => setExpanded(expanded === it.id ? null : it.id)}
              />
            ))
          )}
        </div>
      )}

      {view === "answered" && (
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
            filteredAnswered.map(it => (
              <HistoryAnsweredCard
                key={it.id}
                item={it}
                isExpanded={expanded === it.id}
                onToggle={() => setExpanded(expanded === it.id ? null : it.id)}
              />
            ))
          )}
        </div>
      )}
    </DraggablePanel>
  );
}

const HistoryAllCard = React.memo(function HistoryAllCard({
  item: it,
  isExpanded,
  onToggle,
}: {
  item: KlaxonItem;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  return (
    <div
      style={{
        background: "var(--card)",
        border: "1px solid var(--border)",
        borderRadius: 8,
        padding: "6px 10px",
        cursor: "pointer",
        borderLeft: `3px solid ${LEVEL_COLORS[it.level] ?? "var(--border)"}`,
      }}
      onClick={onToggle}
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
      {isExpanded && (
        <div style={{ marginTop: 6, fontSize: 12, opacity: 0.85 }}>
          {it.message && (
            <div style={{ marginBottom: 4, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
              {it.message}
            </div>
          )}
          {it.form && <div style={{ opacity: 0.7, fontSize: 11 }}>Form: {it.form.title}</div>}
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
  );
});

const HistoryAnsweredCard = React.memo(function HistoryAnsweredCard({
  item: it,
  isExpanded,
  onToggle,
}: {
  item: KlaxonItem;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  const answeredAt = it.answered_at;
  return (
    <div
      style={{
        background: "var(--card)",
        border: "1px solid var(--border)",
        borderRadius: 8,
        padding: "7px 10px",
        cursor: "pointer",
        borderLeft: "3px solid var(--ok)",
      }}
      onClick={onToggle}
    >
      <div style={{ display: "flex", alignItems: "flex-start", gap: 6 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 600, fontSize: 12, marginBottom: 2 }}>{it.title}</div>
          {it.response && (
            <div style={{ fontSize: 11, opacity: 0.7, fontFamily: "monospace" }}>
              {responsePreview(it.response)}
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
              <pre style={{ margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-all" }}>
                {JSON.stringify(it.response, null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
});
