import React, { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { DayTotals } from "@klaxon/protocol";
import { DraggablePanel } from "../components/DraggablePanel";

interface AppSettings {
  theme: string;
  mcp_preferred_port: number;
  budget_usd_daily: number;
}

function fmtUSD(v: number): string {
  return v >= 1 ? `$${v.toFixed(2)}` : `$${v.toFixed(4)}`;
}

function gaugeColor(pct: number): string {
  if (pct >= 0.9) return "var(--danger)";
  if (pct >= 0.6) return "var(--warn)";
  return "var(--ok)";
}

function dayLabel(iso: string): string {
  const d = new Date(iso + "T00:00:00");
  return ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"][d.getDay()];
}

export function BudgetWidget() {
  const [weekTotals, setWeekTotals] = useState<DayTotals[]>([]);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [editingBudget, setEditingBudget] = useState(false);
  const [budgetInput, setBudgetInput] = useState("");

  async function refresh() {
    try {
      const [totals, s] = await Promise.all([
        invoke<DayTotals[]>("tokens_week"),
        invoke<AppSettings>("settings_get"),
      ]);
      setWeekTotals(totals ?? []);
      setSettings(s);
    } catch {}
  }

  useEffect(() => {
    refresh();
    const u1 = listen("tokens.updated", () => refresh());
    const u2 = listen("settings.changed", () => refresh());
    return () => { u1.then(u => u()); u2.then(u => u()); };
  }, []);

  const today = new Date().toISOString().slice(0, 10);
  const todayCost = weekTotals.find(t => t.date === today)?.cost_usd ?? 0;
  const budget = settings?.budget_usd_daily ?? 0;
  const pct = budget > 0 ? Math.min(todayCost / budget, 1) : 0;

  const days: string[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    days.push(d.toISOString().slice(0, 10));
  }

  const maxCost = Math.max(...weekTotals.map(t => t.cost_usd), budget > 0 ? budget : 0, 0.001);

  async function saveBudget() {
    if (!settings) return;
    const v = parseFloat(budgetInput);
    if (isNaN(v) || v < 0) return;
    const updated = { ...settings, budget_usd_daily: v };
    await invoke("settings_set", { settings: updated });
    setSettings(updated);
    setEditingBudget(false);
  }

  return (
    <DraggablePanel id="budget" title="Budget" width={260}>
      <div style={{ marginBottom: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 4 }}>
          <span style={{ fontWeight: 700 }}>{fmtUSD(todayCost)}</span>
          {budget > 0
            ? <span style={{ opacity: 0.65 }}>/ {fmtUSD(budget)} ({Math.round(pct * 100)}%)</span>
            : <span style={{ opacity: 0.5, fontSize: 11 }}>no budget set</span>
          }
        </div>
        {budget > 0 && (
          <div style={{ height: 8, background: "var(--border)", borderRadius: 4, overflow: "hidden" }}>
            <div style={{
              height: "100%", width: `${pct * 100}%`,
              background: gaugeColor(pct),
              borderRadius: 4, transition: "width 0.3s ease",
            }} />
          </div>
        )}
      </div>

      <div style={{ marginBottom: 10 }}>
        <div style={{ fontSize: 10, opacity: 0.5, marginBottom: 4 }}>Last 7 days</div>
        <div style={{ display: "flex", gap: 3, alignItems: "flex-end", height: 44 }}>
          {days.map(d => {
            const cost = weekTotals.find(t => t.date === d)?.cost_usd ?? 0;
            const barH = cost > 0 ? Math.max((cost / maxCost) * 36, 2) : 0;
            const isToday = d === today;
            return (
              <div key={d} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
                <div style={{ flex: 1, display: "flex", alignItems: "flex-end", width: "100%" }}>
                  <div style={{
                    width: "100%", height: barH,
                    background: isToday ? gaugeColor(pct) : "var(--border)",
                    borderRadius: "2px 2px 0 0",
                  }} />
                </div>
                <span style={{ fontSize: 9, opacity: 0.5 }}>{dayLabel(d)}</span>
              </div>
            );
          })}
        </div>
      </div>

      {editingBudget ? (
        <div style={{ display: "flex", gap: 4 }}>
          <input
            type="number"
            value={budgetInput}
            onChange={e => setBudgetInput(e.target.value)}
            placeholder="Daily budget ($)"
            style={{
              flex: 1, background: "var(--card)", border: "1px solid var(--border)",
              borderRadius: 6, padding: "4px 8px", color: "var(--text)", fontSize: 12,
            }}
            onKeyDown={e => { if (e.key === "Enter") saveBudget(); if (e.key === "Escape") setEditingBudget(false); }}
            autoFocus
          />
          <button
            onClick={saveBudget}
            style={{ padding: "4px 8px", borderRadius: 6, cursor: "pointer", background: "var(--ok)", border: "none", color: "#fff", fontSize: 12 }}
          >
            Save
          </button>
        </div>
      ) : (
        <button
          onClick={() => { setBudgetInput(budget > 0 ? String(budget) : ""); setEditingBudget(true); }}
          style={{
            fontSize: 11, padding: "3px 8px", borderRadius: 6, cursor: "pointer",
            background: "var(--card)", border: "1px solid var(--border)", color: "var(--text)",
          }}
        >
          {budget > 0 ? "Edit budget" : "Set budget"}
        </button>
      )}
    </DraggablePanel>
  );
}
