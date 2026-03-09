import React, { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { ModelTotals, SourceModelTotals } from "@klaxon/protocol";
import { DraggablePanel } from "../components/DraggablePanel";
import { fmtTokens, fmtUSD } from "../utils";

interface SourceRow {
  source: string;
  cost_usd: number;
  input_tokens: number;
  output_tokens: number;
  models: SourceModelTotals[];
}

export function TokenWidget() {
  const [tab, setTab] = useState<"model" | "source">("model");
  const [totals, setTotals] = useState<ModelTotals[]>([]);
  const [sourceRows, setSourceRows] = useState<SourceRow[]>([]);
  const [sourceDays, setSourceDays] = useState(1);
  const [expanded, setExpanded] = useState<string | null>(null);

  async function refreshModel() {
    const raw = await invoke<ModelTotals[]>("tokens_today");
    setTotals(raw ?? []);
  }

  async function refreshSource() {
    try {
      const raw = await invoke<SourceModelTotals[]>("tokens_by_source", { days: sourceDays });
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
      setSourceRows(Array.from(map.values()).sort((a, b) => b.cost_usd - a.cost_usd));
    } catch {}
  }

  useEffect(() => {
    refreshModel();
    const unsub = listen("tokens.updated", () => refreshModel());
    return () => {
      unsub.then(u => u());
    };
  }, []);

  useEffect(() => {
    refreshSource();
    const unsub = listen("tokens.updated", () => refreshSource());
    return () => {
      unsub.then(u => u());
    };
  }, [sourceDays]);

  const grandTotal = totals.reduce(
    (acc, m) => ({
      input: acc.input + m.input_tokens,
      output: acc.output + m.output_tokens,
      cost: acc.cost + m.cost_usd,
    }),
    { input: 0, output: 0, cost: 0 }
  );

  const sourceTotal = sourceRows.reduce((s, r) => s + r.cost_usd, 0);

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
    <DraggablePanel id="tokens" title="Token Meter" width={380}>
      <div style={{ display: "flex", borderBottom: "1px solid var(--border)", marginBottom: 8 }}>
        <button style={tabBtnStyle(tab === "model")} onClick={() => setTab("model")}>
          By Model
        </button>
        <button style={tabBtnStyle(tab === "source")} onClick={() => setTab("source")}>
          By Source
        </button>
      </div>

      {tab === "model" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {totals.length === 0 ? (
            <div style={{ fontSize: 13, opacity: 0.7 }}>No token usage today.</div>
          ) : (
            <>
              {totals.map(m => (
                <div
                  key={m.model}
                  style={{
                    background: "var(--card)",
                    border: "1px solid var(--border)",
                    borderRadius: 10,
                    padding: "8px 10px",
                  }}
                >
                  <div style={{ fontWeight: 700, fontSize: 12 }}>{m.model}</div>
                  <div
                    style={{ display: "flex", gap: 12, marginTop: 4, fontSize: 12, opacity: 0.85 }}
                  >
                    <span>↑ {fmtTokens(m.input_tokens)}</span>
                    <span>↓ {fmtTokens(m.output_tokens)}</span>
                    {m.cost_usd > 0 && <span>${m.cost_usd.toFixed(4)}</span>}
                  </div>
                </div>
              ))}
              <div
                style={{
                  borderTop: "1px solid var(--border)",
                  paddingTop: 8,
                  display: "flex",
                  gap: 12,
                  fontSize: 12,
                  opacity: 0.7,
                }}
              >
                <span>Total ↑ {fmtTokens(grandTotal.input)}</span>
                <span>↓ {fmtTokens(grandTotal.output)}</span>
                {grandTotal.cost > 0 && <span>${grandTotal.cost.toFixed(4)}</span>}
              </div>
            </>
          )}
        </div>
      )}

      {tab === "source" && (
        <div>
          <div style={{ display: "flex", gap: 6, marginBottom: 8, alignItems: "center" }}>
            <span style={{ fontSize: 11, opacity: 0.6 }}>Period:</span>
            {[1, 7, 30].map(d => (
              <button
                key={d}
                onClick={() => setSourceDays(d)}
                style={{
                  fontSize: 11,
                  padding: "2px 8px",
                  borderRadius: 6,
                  cursor: "pointer",
                  background: sourceDays === d ? "var(--info)" : "var(--card)",
                  border: `1px solid ${sourceDays === d ? "var(--info)" : "var(--border)"}`,
                  color: sourceDays === d ? "#fff" : "var(--text)",
                }}
              >
                {d === 1 ? "Today" : `${d}d`}
              </button>
            ))}
            <span style={{ marginLeft: "auto", fontSize: 12, fontWeight: 700 }}>
              {fmtUSD(sourceTotal)}
            </span>
          </div>

          {sourceRows.length === 0 ? (
            <div style={{ fontSize: 12, opacity: 0.5 }}>No token data with source tags yet.</div>
          ) : (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 4,
                overflowY: "auto",
                maxHeight: 340,
              }}
            >
              {sourceRows.map(row => {
                const pct = sourceTotal > 0 ? row.cost_usd / sourceTotal : 0;
                const isExpanded = expanded === row.source;
                return (
                  <div
                    key={row.source}
                    style={{
                      background: "var(--card)",
                      border: "1px solid var(--border)",
                      borderRadius: 8,
                    }}
                  >
                    <div
                      style={{ padding: "7px 10px", cursor: "pointer" }}
                      onClick={() => setExpanded(isExpanded ? null : row.source)}
                    >
                      <div
                        style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}
                      >
                        <span style={{ flex: 1, fontSize: 12, fontWeight: 600 }}>{row.source}</span>
                        <span style={{ fontSize: 12, fontWeight: 700 }}>
                          {fmtUSD(row.cost_usd)}
                        </span>
                        <span style={{ fontSize: 10, opacity: 0.5 }}>{Math.round(pct * 100)}%</span>
                      </div>
                      <div
                        style={{
                          height: 4,
                          background: "var(--border)",
                          borderRadius: 2,
                          overflow: "hidden",
                        }}
                      >
                        <div
                          style={{
                            height: "100%",
                            width: `${pct * 100}%`,
                            background: "var(--info)",
                            borderRadius: 2,
                          }}
                        />
                      </div>
                      <div
                        style={{
                          display: "flex",
                          gap: 12,
                          marginTop: 4,
                          fontSize: 10,
                          opacity: 0.55,
                        }}
                      >
                        <span>in {fmtTokens(row.input_tokens)}</span>
                        <span>out {fmtTokens(row.output_tokens)}</span>
                      </div>
                    </div>
                    {isExpanded && (
                      <div style={{ padding: "0 10px 8px", borderTop: "1px solid var(--border)" }}>
                        {row.models.map(m => (
                          <div
                            key={m.model}
                            style={{
                              display: "flex",
                              gap: 8,
                              fontSize: 11,
                              padding: "3px 0",
                              opacity: 0.8,
                            }}
                          >
                            <span style={{ flex: 1, opacity: 0.7 }}>{m.model}</span>
                            <span>{fmtUSD(m.cost_usd)}</span>
                            <span style={{ opacity: 0.5 }}>
                              {fmtTokens(m.input_tokens + m.output_tokens)} tok
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </DraggablePanel>
  );
}
