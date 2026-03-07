import React from "react";
import { KlaxonWidget } from "./widgets/KlaxonWidget";
import { TimerWidget } from "./widgets/TimerWidget";
import { TokenWidget } from "./widgets/TokenWidget";

export function App() {
  const panel = new URLSearchParams(window.location.search).get("panel") ?? "klaxon";
  if (panel === "timer") return <TimerWidget />;
  if (panel === "tokens") return <TokenWidget />;
  return <KlaxonWidget />;
}
