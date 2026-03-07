import React, { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { ModelTotals } from "@klaxon/protocol";
import { DraggablePanel } from "../components/DraggablePanel";

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

export function TokenWidget() {
  const [totals, setTotals] = useState<ModelTotals[]>([]);

  async function refresh() {
    const raw = await invoke<ModelTotals[]>("tokens_today");
    setTotals(raw ?? []);
  }

  useEffect(() => {
    refresh();
    const unsub = listen("tokens.updated", () => refresh());
    return () => { unsub.then(u => u()); };
  }, []);

  const grandTotal = totals.reduce(
    (acc, m) => ({ input: acc.input + m.input_tokens, output: acc.output + m.output_tokens, cost: acc.cost + m.cost_usd }),
    { input: 0, output: 0, cost: 0 },
  );

  return (
    <DraggablePanel id="tokens" title="Token Meter" width={280}>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {totals.length === 0 ? (
          <div style={{ fontSize: 13, opacity: 0.7 }}>No token usage today.</div>
        ) : (
          <>
            {totals.map(m => (
              <div key={m.model} style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 10, padding: "8px 10px" }}>
                <div style={{ fontWeight: 700, fontSize: 12 }}>{m.model}</div>
                <div style={{ display: "flex", gap: 12, marginTop: 4, fontSize: 12, opacity: 0.85 }}>
                  <span>↑ {fmtTokens(m.input_tokens)}</span>
                  <span>↓ {fmtTokens(m.output_tokens)}</span>
                  {m.cost_usd > 0 && <span>${m.cost_usd.toFixed(4)}</span>}
                </div>
              </div>
            ))}
            <div style={{ borderTop: "1px solid var(--border)", paddingTop: 8, display: "flex", gap: 12, fontSize: 12, opacity: 0.7 }}>
              <span>Total ↑ {fmtTokens(grandTotal.input)}</span>
              <span>↓ {fmtTokens(grandTotal.output)}</span>
              {grandTotal.cost > 0 && <span>${grandTotal.cost.toFixed(4)}</span>}
            </div>
          </>
        )}
      </div>
    </DraggablePanel>
  );
}
