import React, { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { WeekEntry } from "@klaxon/protocol";
import { DraggablePanel } from "../components/DraggablePanel";
import { fmtSeconds, dayLabel } from "../utils";

function last7Days(): string[] {
  const days: string[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    days.push(d.toISOString().slice(0, 10));
  }
  return days;
}

const cellStyle: React.CSSProperties = {
  fontSize: 11,
  textAlign: "center",
  padding: "3px 6px",
  minWidth: 36,
};
const headerStyle: React.CSSProperties = { ...cellStyle, fontWeight: 700, opacity: 0.6 };

export function TimerReportWidget() {
  const [entries, setEntries] = useState<WeekEntry[]>([]);
  const [copied, setCopied] = useState(false);

  async function refresh() {
    try {
      const raw = await invoke<WeekEntry[]>("timer_week");
      setEntries(raw ?? []);
    } catch {}
  }

  useEffect(() => {
    refresh();
    const unsub = listen("timer.updated", () => refresh());
    return () => {
      unsub.then(u => u());
    };
  }, []);

  const days = last7Days();
  const issues = [...new Set(entries.map(e => e.issue_id))].sort();

  const lookup = new Map<string, number>();
  for (const e of entries) {
    lookup.set(`${e.issue_id}|${e.date}`, e.seconds);
  }

  const rowTotals = issues.map(id => ({
    id,
    total: days.reduce((s, d) => s + (lookup.get(`${id}|${d}`) ?? 0), 0),
  }));

  const colTotals = days.map(d =>
    entries.filter(e => e.date === d).reduce((s, e) => s + e.seconds, 0)
  );
  const grandTotal = colTotals.reduce((a, b) => a + b, 0);

  function copyText() {
    const lines = ["Issue\t" + days.map(dayLabel).join("\t") + "\tTotal"];
    for (const { id, total } of rowTotals) {
      const row = days.map(d => {
        const s = lookup.get(`${id}|${d}`) ?? 0;
        return s > 0 ? fmtSeconds(s) : "";
      });
      lines.push(`${id}\t${row.join("\t")}\t${fmtSeconds(total)}`);
    }
    lines.push(
      "Total\t" +
        colTotals.map(s => (s > 0 ? fmtSeconds(s) : "")).join("\t") +
        "\t" +
        fmtSeconds(grandTotal)
    );
    navigator.clipboard.writeText(lines.join("\n")).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <DraggablePanel id="timer-report" title="Timer Report" width={460}>
      {issues.length === 0 ? (
        <div style={{ fontSize: 12, opacity: 0.6 }}>No timer data this week.</div>
      ) : (
        <>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th style={{ ...headerStyle, textAlign: "left", minWidth: 80 }}>Issue</th>
                  {days.map(d => (
                    <th key={d} style={headerStyle}>
                      {dayLabel(d)}
                    </th>
                  ))}
                  <th style={headerStyle}>Total</th>
                </tr>
              </thead>
              <tbody>
                {rowTotals.map(({ id, total }) => (
                  <tr key={id} style={{ borderTop: "1px solid var(--border)" }}>
                    <td style={{ fontSize: 11, padding: "3px 6px", fontWeight: 600 }}>{id}</td>
                    {days.map(d => {
                      const s = lookup.get(`${id}|${d}`) ?? 0;
                      return (
                        <td key={d} style={{ ...cellStyle, opacity: s > 0 ? 1 : 0.25 }}>
                          {s > 0 ? fmtSeconds(s) : "—"}
                        </td>
                      );
                    })}
                    <td style={{ ...cellStyle, fontWeight: 700 }}>{fmtSeconds(total)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr style={{ borderTop: "2px solid var(--border)" }}>
                  <td style={{ ...cellStyle, textAlign: "left", fontWeight: 700, opacity: 0.6 }}>
                    Total
                  </td>
                  {colTotals.map((s, i) => (
                    <td
                      key={i}
                      style={{ ...cellStyle, fontWeight: 700, opacity: s > 0 ? 1 : 0.25 }}
                    >
                      {s > 0 ? fmtSeconds(s) : "—"}
                    </td>
                  ))}
                  <td style={{ ...cellStyle, fontWeight: 700 }}>{fmtSeconds(grandTotal)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
          <div style={{ marginTop: 8, textAlign: "right" }}>
            <button
              onClick={copyText}
              style={{
                fontSize: 11,
                padding: "4px 10px",
                borderRadius: 6,
                cursor: "pointer",
                background: "var(--card)",
                border: "1px solid var(--border)",
                color: "var(--text)",
              }}
            >
              {copied ? "Copied!" : "Copy as text"}
            </button>
          </div>
        </>
      )}
    </DraggablePanel>
  );
}
