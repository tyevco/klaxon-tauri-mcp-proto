import React, { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

type Props = {
  id: string;
  width?: number;
  children: React.ReactNode;
  title?: string;
};

export function DraggablePanel({ id, width = 360, children, title }: Props) {
  const [pinned, setPinned] = useState(true);
  const pinnedRef = useRef(pinned);
  pinnedRef.current = pinned;
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (typeof (window as any).__TAURI_INTERNALS__ === "undefined") return;
    const el = panelRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => {
      invoke("resize_window", { label: id, width: el.offsetWidth, height: el.offsetHeight }).catch(
        () => {}
      );
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [id]);

  // Handle native popup menu selections routed back from Rust.
  useEffect(() => {
    if (typeof (window as any).__TAURI_INTERNALS__ === "undefined") return;
    const unsub = listen<{ action: string }>("panel.menu", event => {
      if (event.payload.action === "minimize") {
        invoke("hide_panel", { label: id }).catch(() => {});
      } else if (event.payload.action === "pin") {
        const next = !pinnedRef.current;
        setPinned(next);
        invoke("set_panel_always_on_top", { label: id, onTop: next }).catch(() => {});
      }
    });
    return () => {
      unsub.then(u => u());
    };
  }, [id]);

  function onHeaderMouseDown(e: React.MouseEvent) {
    if (e.button !== 0) return;
    e.preventDefault();
    invoke("start_panel_drag");
  }

  function onTitleBarContextMenu(e: React.MouseEvent) {
    e.preventDefault();
    invoke("show_panel_menu", { label: id, pinned: pinnedRef.current });
  }

  async function handleMinimize() {
    if (typeof (window as any).__TAURI_INTERNALS__ === "undefined") return;
    await invoke("hide_panel", { label: id });
  }

  async function togglePin() {
    const next = !pinned;
    setPinned(next);
    await invoke("set_panel_always_on_top", { label: id, onTop: next });
  }

  return (
    <div
      ref={panelRef}
      onContextMenu={e => e.preventDefault()}
      style={{
        width,
        background: "var(--bg)",
        border: "1px solid var(--border)",
        borderRadius: 12,
        boxSizing: "border-box",
        userSelect: "none",
        overflow: "hidden",
      }}
    >
      {/* Title bar — right-click opens native OS popup menu */}
      <div
        onMouseDown={onHeaderMouseDown}
        onContextMenu={onTitleBarContextMenu}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "7px 10px",
          background: "rgba(255,255,255,0.04)",
          borderBottom: "1px solid var(--border)",
          cursor: "default",
        }}
      >
        <div
          style={{
            flex: 1,
            fontWeight: 700,
            fontSize: 12,
            opacity: 0.85,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {title ?? id}
        </div>
        <div
          style={{ display: "flex", gap: 2, flexShrink: 0 }}
          onMouseDown={e => e.stopPropagation()}
        >
          <button onClick={handleMinimize} style={toolbarBtnStyle()} title="Minimize">
            –
          </button>
          <button
            onClick={togglePin}
            style={toolbarBtnStyle()}
            title={pinned ? "Unpin window" : "Pin window on top"}
          >
            {pinned ? "📌" : "📍"}
          </button>
        </div>
      </div>

      {/* Content */}
      <div style={{ padding: 12, userSelect: "text" }}>{children}</div>
    </div>
  );
}

function toolbarBtnStyle(): React.CSSProperties {
  return {
    background: "none",
    border: "none",
    cursor: "pointer",
    fontSize: 13,
    opacity: 0.6,
    padding: "0 4px",
    color: "inherit",
    lineHeight: 1,
  };
}
