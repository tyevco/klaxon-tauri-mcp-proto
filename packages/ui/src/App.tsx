import React, { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { AppSettings } from "@klaxon/protocol";
import { KlaxonWidget } from "./widgets/KlaxonWidget";
import { TimerWidget } from "./widgets/TimerWidget";
import { TokenWidget } from "./widgets/TokenWidget";
import { SettingsWidget } from "./widgets/SettingsWidget";
import { FormWidget } from "./widgets/FormWidget";
import { HistoryWidget } from "./widgets/HistoryWidget";
import { TimerReportWidget } from "./widgets/TimerReportWidget";
import { BudgetWidget } from "./widgets/BudgetWidget";
import { AgentsWidget } from "./widgets/AgentsWidget";
import { SessionWidget } from "./widgets/SessionWidget";
import { ScratchpadWidget } from "./widgets/ScratchpadWidget";
import { CheckpointWidget } from "./widgets/CheckpointWidget";
import { LogTailWidget } from "./widgets/LogTailWidget";
import { ToolLogWidget } from "./widgets/ToolLogWidget";
import { QueueWidget } from "./widgets/QueueWidget";

export function App() {
  useEffect(() => {
    if (typeof (window as any).__TAURI_INTERNALS__ === "undefined") return;

    const applyTheme = () => {
      invoke<AppSettings>("settings_get")
        .then(s => {
          document.documentElement.dataset.theme = s.theme;
        })
        .catch(() => {});
    };

    // Apply theme on initial load
    applyTheme();

    // Listen for theme changes broadcast from the settings panel
    const unsub = listen<AppSettings>("settings.changed", e => {
      document.documentElement.dataset.theme = e.payload.theme;
    });

    // Re-apply theme when a hidden panel becomes visible again,
    // in case the event was missed while the webview was hidden
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        applyTheme();
      }
    };
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      unsub.then(u => u());
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, []);

  const panel = new URLSearchParams(window.location.search).get("panel") ?? "klaxon";
  if (panel === "timer") return <TimerWidget />;
  if (panel === "tokens") return <TokenWidget />;
  if (panel === "settings") return <SettingsWidget />;
  if (panel === "form") return <FormWidget />;
  if (panel === "history") return <HistoryWidget />;
  if (panel === "timer-report") return <TimerReportWidget />;
  if (panel === "budget") return <BudgetWidget />;
  if (panel === "agents") return <AgentsWidget />;
  if (panel === "session") return <SessionWidget />;
  if (panel === "scratchpad") return <ScratchpadWidget />;
  if (panel === "checkpoints") return <CheckpointWidget />;
  if (panel === "logtail") return <LogTailWidget />;
  if (panel === "toollog") return <ToolLogWidget />;
  if (panel === "queue") return <QueueWidget />;
  return <KlaxonWidget />;
}
