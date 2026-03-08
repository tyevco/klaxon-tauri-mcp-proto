import React, { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { SourceModelTotals } from "@klaxon/protocol";
import { DraggablePanel } from "../components/DraggablePanel";

function fmtUSD(v: number): string {
  return v >= 1 ? `$${v.toFixed(2)}` : `$${v.toFixed(4)}`;
}

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}k`;
  return String(n);
}

interface SourceRow {
  source: string;
  cost_usd: number;
  input_tokens: number;
  output_tokens: number;
  models: SourceModelTotals[];
}

export function CostmapWidget() {
  const [rows, setRows] = useState<SourceRow[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [days, setDays] = useState(1);

  async function refresh() {
    try {
      const raw = await invoke<SourceModelTotals[]>("tokens_by_source", { days });
      // Group by source
      const map = new Map<string, SourceRow>();
      for (const entry of raw ?? []) {
        const existing = map.get(entry.source);
        if (existing) {
          existing.cost_usd += entry.cost_usd;
          existing.input_tokens += entry.input_tokens;
          existing.output_tokens += entry.output_tokens;
          existing.models.push(entry);
        } else {
          map.set(entry.source, {
            source: entry.source,
            cost_usd: entry.cost_usd,
            input_tokens: entry.input_tokens,
            output_tokens: entry.output_tokens,
            models: [entry],
          });
        }
      }
      const sorted = Array.from(map.values()).sort((a, b) => b.cost_usd - a.cost_usd);
      setRows(sorted);
    } catch {}
  }

  useEffect(() => {
    refresh();
  }, [days]);

  useEffect(() => {
    const u1 = listen("tokens.updated", () => refresh());
    return () => { u1.then(u => u()); };
  }, [days]);

  const total = rows.reduce((s, r) => s + r.cost_usd, 0);

  return (
    <DraggablePanel id="costmap" title="Cost Map" width={380}>
      <div style={{ display: "flex", gap: 6, marginBottom: 8, alignItems: "center" }}>
        <span style={{ fontSize: 11, opacity: 0.6 }}>Period:</span>
        {[1, 7, 30].map(d => (
          <button
            key={d}
            onClick={() => setDays(d)}
            style={{
              fontSize: 11, padding: "2px 8px", borderRadius: 6, cursor: "pointer",
              background: days === d ? "var(--info)" : "var(--card)",
              border: `1px solid ${days === d ? "var(--info)" : "var(--border)"}`,
              color: days === d ? "#fff" : "var(--text)",
            }}
          >
            {d === 1 ? "Today" : `${d}d`}
          </button>
        ))}
        <span style={{ marginLeft: "auto", fontSize: 12, fontWeight: 700 }}>{fmtUSD(total)}</span>
      </div>

      {rows.length === 0 ? (
        <div style={{ fontSize: 12, opacity: 0.5 }}>No token data with source tags yet.</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 4, overflowY: "auto", maxHeight: 380 }}>
          {rows.map(row => {
            const pct = total > 0 ? row.cost_usd / total : 0;
            const isExpanded = expanded === row.source;
            return (
              <div
                key={row.source}
                style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 8 }}
              >
                <div
                  style={{ padding: "7px 10px", cursor: "pointer" }}
                  onClick={() => setExpanded(isExpanded ? null : row.source)}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                    <span style={{ flex: 1, fontSize: 12, fontWeight: 600 }}>{row.source}</span>
                    <span style={{ fontSize: 12, fontWeight: 700 }}>{fmtUSD(row.cost_usd)}</span>
                    <span style={{ fontSize: 10, opacity: 0.5 }}>{Math.round(pct * 100)}%</span>
                  </div>
                  <div style={{ height: 4, background: "var(--border)", borderRadius: 2, overflow: "hidden" }}>
                    <div style={{ height: "100%", width: `${pct * 100}%`, background: "var(--info)", borderRadius: 2 }} />
                  </div>
                  <div style={{ display: "flex", gap: 12, marginTop: 4, fontSize: 10, opacity: 0.55 }}>
                    <span>in {fmtTokens(row.input_tokens)}</span>
                    <span>out {fmtTokens(row.output_tokens)}</span>
                  </div>
                </div>
                {isExpanded && (
                  <div style={{ padding: "0 10px 8px", borderTop: "1px solid var(--border)" }}>
                    {row.models.map(m => (
                      <div key={m.model} style={{ display: "flex", gap: 8, fontSize: 11, padding: "3px 0", opacity: 0.8 }}>
                        <span style={{ flex: 1, opacity: 0.7 }}>{m.model}</span>
                        <span>{fmtUSD(m.cost_usd)}</span>
                        <span style={{ opacity: 0.5 }}>{fmtTokens(m.input_tokens + m.output_tokens)} tok</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </DraggablePanel>
  );
}
