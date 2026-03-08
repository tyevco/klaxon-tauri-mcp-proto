import React, { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { KlaxonItem, KlaxonItemSchema } from "@klaxon/protocol";
import { DraggablePanel } from "../components/DraggablePanel";

function badgeColor(level: string) {
  switch (level) {
    case "error": return "var(--danger)";
    case "warning": return "var(--warn)";
    case "success": return "var(--ok)";
    default: return "var(--info)";
  }
}

export function KlaxonWidget() {
  const [items, setItems] = useState<KlaxonItem[]>([]);
  const [busy, setBusy] = useState(false);

  async function refresh() {
    setBusy(true);
    try {
      const raw = (await invoke("klaxon_list_open")) as unknown[];
      setItems(raw.map(i => KlaxonItemSchema.parse(i)));
    } catch (err) {
      console.error("[KlaxonWidget] refresh failed:", err);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (typeof Notification !== "undefined" && Notification.permission === "default") {
      Notification.requestPermission();
    }
    refresh();
    const u1 = listen("klaxon.updated", () => refresh());
    const u2 = listen<KlaxonItem>("klaxon.created", (event) => {
      refresh();
      if (typeof Notification !== "undefined" && Notification.permission === "granted") {
        new Notification(event.payload.title, { body: event.payload.message });
      }
    });
    return () => { u1.then(u => u()); u2.then(u => u()); };
  }, []);

  return (
    <DraggablePanel id="klaxon" title="Klaxon" width={380}>
      <div style={{ display:"flex", gap:8, alignItems:"center", justifyContent:"space-between", marginBottom: 10 }}>
        <div style={{ fontSize: 12, opacity: 0.7 }}>{items.length} open</div>
        <button onClick={refresh} disabled={busy} style={{ background:"transparent", border:"1px solid var(--border)", color:"var(--text)", borderRadius: 10, padding:"6px 10px" }}>
          {busy ? "…" : "Refresh"}
        </button>
      </div>

      <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
        {items.map(item => (
          <KlaxonCard key={item.id} item={item} onChanged={refresh} />
        ))}
        {items.length === 0 && (
          <div style={{ fontSize: 13, opacity: 0.7 }}>No active klaxons.</div>
        )}
      </div>
    </DraggablePanel>
  );
}

function KlaxonCard({ item, onChanged }: { item: KlaxonItem; onChanged: () => void }) {
  async function ack() {
    await invoke("klaxon_ack", { id: item.id });
    onChanged();
  }

  async function dismiss() {
    await invoke("klaxon_dismiss", { id: item.id });
    onChanged();
  }

  async function runAction(actionId: string) {
    await invoke("klaxon_run_action", { id: item.id, actionId });
    onChanged();
  }

  return (
    <div style={{ background:"var(--card)", border:"1px solid var(--border)", borderRadius: 12, padding: 12 }}>
      <div style={{ display:"flex", alignItems:"flex-start", justifyContent:"space-between", gap:8 }}>
        <div>
          <div style={{ display:"flex", alignItems:"center", gap:8 }}>
            <span style={{ width:10, height:10, borderRadius:99, background: badgeColor(item.level) }} />
            <div style={{ fontWeight: 700 }}>{item.title}</div>
          </div>
          {item.message && (
            <div className="klaxon-md" style={{ marginTop: 6, fontSize: 13, opacity: 0.85 }}>
              <ReactMarkdown>{item.message}</ReactMarkdown>
            </div>
          )}
        </div>
        <div style={{ display:"flex", gap:6 }}>
          <button onClick={ack} style={btnStyle()}>Ack</button>
          <button onClick={dismiss} style={btnStyle()}>Dismiss</button>
        </div>
      </div>

      {item.actions?.length ? (
        <div style={{ display:"flex", flexWrap:"wrap", gap:8, marginTop: 10 }}>
          {item.actions.map(a => (
            <button key={a.id} onClick={() => runAction(a.id)} style={btnStyle()}>
              {a.label}
            </button>
          ))}
        </div>
      ) : null}

      {item.form && item.status === "open" && (
        <div style={{ marginTop: 10 }}>
          <button onClick={() => invoke("klaxon_open_form", { id: item.id })} style={primaryBtnStyle()}>
            Open Form
          </button>
        </div>
      )}
      {item.form && item.status === "answered" && (
        <div style={{ marginTop: 8, fontSize: 12, opacity: 0.6 }}>Answered</div>
      )}
      {item.ttl_ms && <TtlBar createdAt={item.created_at} ttlMs={item.ttl_ms} />}
    </div>
  );
}

function btnStyle(): React.CSSProperties {
  return {
    background:"transparent",
    border:"1px solid var(--border)",
    color:"var(--text)",
    borderRadius: 10,
    padding:"6px 10px",
    fontSize: 12,
  };
}
function primaryBtnStyle(): React.CSSProperties {
  return {
    background:"rgba(90, 169, 255, 0.18)",
    border:"1px solid rgba(90, 169, 255, 0.5)",
    color:"var(--text)",
    borderRadius: 10,
    padding:"6px 10px",
    fontSize: 12,
  };
}

function DiffView({ diff }: { diff: string }) {
  return (
    <pre style={{ margin: 0, fontSize: 11, whiteSpace: "pre-wrap", opacity: 0.9 }}>
      {diff.split('\n').map((line, i) => {
        const color =
          line.startsWith('+') ? 'var(--ok)'
        : line.startsWith('-') ? 'var(--danger)'
        : line.startsWith('@') ? 'var(--info)'
        : undefined;
        return <span key={i} style={{ color, display: 'block' }}>{line}</span>;
      })}
    </pre>
  );
}

function TtlBar({ createdAt, ttlMs }: { createdAt: string; ttlMs: number }) {
  const [pct, setPct] = useState(() => {
    const elapsed = Date.now() - new Date(createdAt).getTime();
    return Math.max(0, ((ttlMs - elapsed) / ttlMs) * 100);
  });
  useEffect(() => {
    const id = setInterval(() => {
      setPct(() => {
        const elapsed = Date.now() - new Date(createdAt).getTime();
        return Math.max(0, ((ttlMs - elapsed) / ttlMs) * 100);
      });
    }, 250);
    return () => clearInterval(id);
  }, [createdAt, ttlMs]);

  const color = pct > 50 ? 'var(--ok)' : pct > 20 ? 'var(--warn)' : 'var(--danger)';
  return (
    <div style={{ height: 3, background: 'rgba(255,255,255,0.08)', borderRadius: '0 0 10px 10px', overflow: 'hidden', marginTop: 10 }}>
      <div style={{ height: '100%', width: `${pct}%`, background: color, transition: 'width 0.25s linear' }} />
    </div>
  );
}
