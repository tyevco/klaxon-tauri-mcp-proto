import React, { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { KlaxonWidget } from "./widgets/KlaxonWidget";
import { TimerWidget } from "./widgets/TimerWidget";
import { TokenWidget } from "./widgets/TokenWidget";
import { SettingsWidget } from "./widgets/SettingsWidget";
import { FormWidget } from "./widgets/FormWidget";
import { HistoryWidget } from "./widgets/HistoryWidget";
import { TimerReportWidget } from "./widgets/TimerReportWidget";
import { BudgetWidget } from "./widgets/BudgetWidget";
import { AgentsWidget } from "./widgets/AgentsWidget";
import { CostmapWidget } from "./widgets/CostmapWidget";
import { DecisionsWidget } from "./widgets/DecisionsWidget";
import { SessionWidget } from "./widgets/SessionWidget";
import { ScratchpadWidget } from "./widgets/ScratchpadWidget";
import { CheckpointWidget } from "./widgets/CheckpointWidget";
import { LogTailWidget } from "./widgets/LogTailWidget";
import { ToolLogWidget } from "./widgets/ToolLogWidget";
import { AlertsWidget } from "./widgets/AlertsWidget";
import { QueueWidget } from "./widgets/QueueWidget";

interface AppSettings {
  theme: string;
  mcp_preferred_port: number;
}

export function App() {
  useEffect(() => {
    if (typeof (window as any).__TAURI_INTERNALS__ === "undefined") return;
    invoke<AppSettings>("settings_get").then(s => {
      document.documentElement.dataset.theme = s.theme;
    }).catch(() => {});
    const unsub = listen<AppSettings>("settings.changed", e => {
      document.documentElement.dataset.theme = e.payload.theme;
    });
    return () => { unsub.then(u => u()); };
  }, []);

  const panel = new URLSearchParams(window.location.search).get("panel") ?? "klaxon";
  if (panel === "timer")        return <TimerWidget />;
  if (panel === "tokens")       return <TokenWidget />;
  if (panel === "settings")     return <SettingsWidget />;
  if (panel === "form")         return <FormWidget />;
  if (panel === "history")      return <HistoryWidget />;
  if (panel === "timer-report") return <TimerReportWidget />;
  if (panel === "budget")       return <BudgetWidget />;
  if (panel === "agents")       return <AgentsWidget />;
  if (panel === "costmap")      return <CostmapWidget />;
  if (panel === "decisions")    return <DecisionsWidget />;
  if (panel === "session")      return <SessionWidget />;
  if (panel === "scratchpad")   return <ScratchpadWidget />;
  if (panel === "checkpoints")  return <CheckpointWidget />;
  if (panel === "logtail")      return <LogTailWidget />;
  if (panel === "toollog")      return <ToolLogWidget />;
  if (panel === "alerts")       return <AlertsWidget />;
  if (panel === "queue")        return <QueueWidget />;
  return <KlaxonWidget />;
}
