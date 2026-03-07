import React, { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { KlaxonWidget } from "./widgets/KlaxonWidget";
import { TimerWidget } from "./widgets/TimerWidget";
import { TokenWidget } from "./widgets/TokenWidget";
import { SettingsWidget } from "./widgets/SettingsWidget";

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
  if (panel === "timer") return <TimerWidget />;
  if (panel === "tokens") return <TokenWidget />;
  if (panel === "settings") return <SettingsWidget />;
  return <KlaxonWidget />;
}
