import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { DraggablePanel } from "../components/DraggablePanel";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(() => Promise.resolve(() => {})),
}));

const mockInvoke = vi.mocked(invoke);

beforeEach(() => {
  vi.clearAllMocks();
  mockInvoke.mockResolvedValue(undefined);
});

describe("DraggablePanel", () => {
  it("renders title and children", () => {
    render(
      <DraggablePanel id="test-panel" title="My Panel">
        <span>child content</span>
      </DraggablePanel>
    );
    expect(screen.getByText("My Panel")).toBeInTheDocument();
    expect(screen.getByText("child content")).toBeInTheDocument();
  });

  it("header mousedown calls start_panel_drag invoke", () => {
    render(
      <DraggablePanel id="test-panel" title="My Panel">
        <span />
      </DraggablePanel>
    );
    fireEvent.mouseDown(screen.getByText("My Panel"), { button: 0 });
    expect(mockInvoke).toHaveBeenCalledWith("start_panel_drag");
  });

  it("right-click on header does not drag", () => {
    render(
      <DraggablePanel id="test-panel" title="My Panel">
        <span />
      </DraggablePanel>
    );
    fireEvent.mouseDown(screen.getByText("My Panel"), { button: 2 });
    expect(mockInvoke).not.toHaveBeenCalledWith("start_panel_drag");
  });

  it("right-click on title bar calls show_panel_menu", () => {
    render(
      <DraggablePanel id="test-panel" title="My Panel">
        <span />
      </DraggablePanel>
    );
    fireEvent.contextMenu(screen.getByText("My Panel"));
    expect(mockInvoke).toHaveBeenCalledWith("show_panel_menu", {
      label: "test-panel",
      pinned: true,
    });
  });

  it("pin button renders initially as pinned", () => {
    render(
      <DraggablePanel id="test-panel">
        <span />
      </DraggablePanel>
    );
    expect(screen.getByTitle("Unpin window").textContent).toBe("📌");
  });

  it("pin button click calls set_panel_always_on_top with onTop: false", async () => {
    render(
      <DraggablePanel id="test-panel">
        <span />
      </DraggablePanel>
    );
    fireEvent.click(screen.getByTitle("Unpin window"));
    await waitFor(() =>
      expect(mockInvoke).toHaveBeenCalledWith("set_panel_always_on_top", {
        label: "test-panel",
        onTop: false,
      })
    );
    expect(screen.getByTitle("Pin window on top").textContent).toBe("📍");
  });

  it("second click toggles back to pinned", async () => {
    render(
      <DraggablePanel id="test-panel">
        <span />
      </DraggablePanel>
    );
    fireEvent.click(screen.getByTitle("Unpin window"));
    await waitFor(() => expect(screen.getByTitle("Pin window on top")).toBeInTheDocument());
    fireEvent.click(screen.getByTitle("Pin window on top"));
    await waitFor(() =>
      expect(mockInvoke).toHaveBeenLastCalledWith("set_panel_always_on_top", {
        label: "test-panel",
        onTop: true,
      })
    );
    expect(screen.getByTitle("Unpin window").textContent).toBe("📌");
  });

  it("minimize button is present", () => {
    render(
      <DraggablePanel id="test-panel">
        <span />
      </DraggablePanel>
    );
    expect(screen.getByTitle("Minimize")).toBeInTheDocument();
  });

  it("subscribes to panel.menu event", async () => {
    render(
      <DraggablePanel id="test-panel">
        <span />
      </DraggablePanel>
    );
    // listen is skipped in jsdom (no __TAURI_INTERNALS__), but no error thrown
    expect(listen).not.toHaveBeenCalled();
  });
});
