import React, { useCallback, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { DayTotals, AppSettings } from "@klaxon/protocol";
import { DraggablePanel } from "../components/DraggablePanel";
import { fmtUSD, dayLabel } from "../utils";
import { useTauriEvents } from "../hooks/useTauriEvent";

function gaugeColor(pct: number): string {
  if (pct >= 0.9) return "var(--danger)";
  if (pct >= 0.6) return "var(--warn)";
  return "var(--ok)";
}

function buildLast7Days(): string[] {
  const days: string[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    days.push(d.toISOString().slice(0, 10));
  }
  return days;
}

export function BudgetWidget() {
  const [weekTotals, setWeekTotals] = useState<DayTotals[]>([]);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [editingBudget, setEditingBudget] = useState(false);
  const [budgetInput, setBudgetInput] = useState("");

  const refresh = useCallback(async () => {
    try {
      const [totals, s] = await Promise.all([
        invoke<DayTotals[]>("tokens_week"),
        invoke<AppSettings>("settings_get"),
      ]);
      setWeekTotals(totals ?? []);
      setSettings(s);
    } catch (err) {
      console.error("[BudgetWidget] refresh failed:", err);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useTauriEvents([
    { event: "tokens.updated", handler: refresh },
    { event: "settings.changed", handler: refresh },
  ]);

  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const todayCost = useMemo(
    () => weekTotals.find(t => t.date === today)?.cost_usd ?? 0,
    [weekTotals, today],
  );
  const budget = settings?.budget_usd_daily ?? 0;
  const pct = budget > 0 ? Math.min(todayCost / budget, 1) : 0;

  const days = useMemo(buildLast7Days, []);
  const maxCost = useMemo(
    () => Math.max(...weekTotals.map(t => t.cost_usd), budget > 0 ? budget : 0, 0.001),
    [weekTotals, budget],
  );

  const saveBudget = useCallback(async () => {
    if (!settings) return;
    const v = parseFloat(budgetInput);
    if (isNaN(v) || v < 0) return;
    const updated = { ...settings, budget_usd_daily: v };
    try {
      await invoke("settings_set", { settings: updated });
    } catch (err) {
      console.error("[BudgetWidget] saveBudget failed:", err);
    }
    setSettings(updated);
    setEditingBudget(false);
  }, [settings, budgetInput]);

  const onBudgetKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") saveBudget();
      if (e.key === "Escape") setEditingBudget(false);
    },
    [saveBudget],
  );

  return (
    <DraggablePanel id="budget" title="Budget" width={260}>
      <div style={{ marginBottom: 12 }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            fontSize: 12,
            marginBottom: 4,
          }}
        >
          <span style={{ fontWeight: 700 }}>{fmtUSD(todayCost)}</span>
          {budget > 0 ? (
            <span style={{ opacity: 0.65 }}>
              / {fmtUSD(budget)} ({Math.round(pct * 100)}%)
            </span>
          ) : (
            <span style={{ opacity: 0.5, fontSize: 11 }}>no budget set</span>
          )}
        </div>
        {budget > 0 && (
          <div
            style={{ height: 8, background: "var(--border)", borderRadius: 4, overflow: "hidden" }}
          >
            <div
              style={{
                height: "100%",
                width: `${pct * 100}%`,
                background: gaugeColor(pct),
                borderRadius: 4,
                transition: "width 0.3s ease",
              }}
            />
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
              <div
                key={d}
                style={{
                  flex: 1,
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: 2,
                }}
              >
                <div style={{ flex: 1, display: "flex", alignItems: "flex-end", width: "100%" }}>
                  <div
                    style={{
                      width: "100%",
                      height: barH,
                      background: isToday ? gaugeColor(pct) : "var(--border)",
                      borderRadius: "2px 2px 0 0",
                    }}
                  />
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
              flex: 1,
              background: "var(--card)",
              border: "1px solid var(--border)",
              borderRadius: 6,
              padding: "4px 8px",
              color: "var(--text)",
              fontSize: 12,
            }}
            onKeyDown={onBudgetKeyDown}
            autoFocus
          />
          <button
            onClick={saveBudget}
            style={{
              padding: "4px 8px",
              borderRadius: 6,
              cursor: "pointer",
              background: "var(--ok)",
              border: "none",
              color: "#fff",
              fontSize: 12,
            }}
          >
            Save
          </button>
        </div>
      ) : (
        <button
          onClick={() => {
            setBudgetInput(budget > 0 ? String(budget) : "");
            setEditingBudget(true);
          }}
          style={{
            fontSize: 11,
            padding: "3px 8px",
            borderRadius: 6,
            cursor: "pointer",
            background: "var(--card)",
            border: "1px solid var(--border)",
            color: "var(--text)",
          }}
        >
          {budget > 0 ? "Edit budget" : "Set budget"}
        </button>
      )}
    </DraggablePanel>
  );
}
