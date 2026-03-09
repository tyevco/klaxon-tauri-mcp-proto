import React, { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useTauriEvent } from "../hooks/useTauriEvent";

type Props = {
  id: string;
  width?: number;
  children: React.ReactNode;
  title?: string;
};

const TOOLBAR_BTN_STYLE: React.CSSProperties = {
  background: "none",
  border: "none",
  cursor: "pointer",
  fontSize: 13,
  opacity: 0.6,
  padding: "0 4px",
  color: "inherit",
  lineHeight: 1,
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
        () => {},
      );
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [id]);

  const handleMenuAction = useCallback(
    (payload: { action: string }) => {
      if (payload.action === "minimize") {
        invoke("hide_panel", { label: id }).catch(() => {});
      } else if (payload.action === "pin") {
        const next = !pinnedRef.current;
        setPinned(next);
        invoke("set_panel_always_on_top", { label: id, onTop: next }).catch(() => {});
      }
    },
    [id],
  );

  useTauriEvent<{ action: string }>(
    "panel.menu",
    handleMenuAction,
    [id],
  );

  const onHeaderMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    invoke("start_panel_drag");
  }, []);

  const onTitleBarContextMenu = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      invoke("show_panel_menu", { label: id, pinned: pinnedRef.current });
    },
    [id],
  );

  const handleMinimize = useCallback(async () => {
    if (typeof (window as any).__TAURI_INTERNALS__ === "undefined") return;
    await invoke("hide_panel", { label: id });
  }, [id]);

  const togglePin = useCallback(async () => {
    const next = !pinned;
    setPinned(next);
    await invoke("set_panel_always_on_top", { label: id, onTop: next });
  }, [id, pinned]);

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
          <button onClick={handleMinimize} style={TOOLBAR_BTN_STYLE} title="Minimize">
            –
          </button>
          <button
            onClick={togglePin}
            style={TOOLBAR_BTN_STYLE}
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
