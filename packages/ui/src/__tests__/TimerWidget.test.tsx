import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { TimerWidget } from "../widgets/TimerWidget";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(() => Promise.resolve(() => {})),
}));

const mockInvoke = vi.mocked(invoke);

function setupToday(today: unknown[]) {
  mockInvoke.mockImplementation((cmd: string) => {
    if (cmd === "timer_today") return Promise.resolve(today);
    return Promise.resolve(null);
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("TimerWidget", () => {
  it("renders empty state when no entries", async () => {
    setupToday([]);
    render(<TimerWidget />);
    await waitFor(() => expect(screen.getByText("No active timer.")).toBeInTheDocument());
  });

  it("renders today entries without active badge when not running", async () => {
    setupToday([
      { issue_id: "PROJ-1", seconds: 3660 },
      { issue_id: "PROJ-2", seconds: 90 },
    ]);
    render(<TimerWidget />);
    await waitFor(() => expect(screen.getByText("PROJ-1")).toBeInTheDocument());
    expect(screen.getByText("PROJ-2")).toBeInTheDocument();
    expect(screen.getByText("1h 01m")).toBeInTheDocument();
    expect(screen.getByText("01:30")).toBeInTheDocument();
    // No active indicators
    expect(screen.queryByText("●")).not.toBeInTheDocument();
  });

  it("shows active indicator and pause button for running entry", async () => {
    setupToday([
      { issue_id: "PROJ-1", seconds: 60, active_since: new Date().toISOString() },
    ]);
    render(<TimerWidget />);
    await waitFor(() => expect(screen.getByText("PROJ-1")).toBeInTheDocument());
    expect(screen.getByText("●")).toBeInTheDocument();
    expect(screen.getByText("⏸")).toBeInTheDocument();
  });

  it("shows play button for inactive entry", async () => {
    setupToday([{ issue_id: "PROJ-1", seconds: 120 }]);
    render(<TimerWidget />);
    await waitFor(() => screen.getByText("PROJ-1"));
    expect(screen.getByText("▶")).toBeInTheDocument();
  });

  it("pause button calls timer_stop with issueId", async () => {
    setupToday([
      { issue_id: "PROJ-1", seconds: 0, active_since: new Date().toISOString() },
    ]);
    render(<TimerWidget />);
    await waitFor(() => screen.getByText("⏸"));
    fireEvent.click(screen.getByText("⏸"));
    await waitFor(() =>
      expect(mockInvoke).toHaveBeenCalledWith("timer_stop", { issueId: "PROJ-1" }),
    );
  });

  it("play button calls timer_start with issueId", async () => {
    setupToday([{ issue_id: "PROJ-2", seconds: 300 }]);
    render(<TimerWidget />);
    await waitFor(() => screen.getByText("▶"));
    fireEvent.click(screen.getByText("▶"));
    await waitFor(() =>
      expect(mockInvoke).toHaveBeenCalledWith("timer_start", { issueId: "PROJ-2" }),
    );
  });

  it("Start button calls timer_start with input value", async () => {
    setupToday([]);
    render(<TimerWidget />);
    await waitFor(() => screen.getByPlaceholderText("PROJ-123"));
    fireEvent.change(screen.getByPlaceholderText("PROJ-123"), { target: { value: "PROJ-42" } });
    fireEvent.click(screen.getByText("Start"));
    await waitFor(() =>
      expect(mockInvoke).toHaveBeenCalledWith("timer_start", { issueId: "PROJ-42" }),
    );
  });

  it("Enter key calls timer_start", async () => {
    setupToday([]);
    render(<TimerWidget />);
    await waitFor(() => screen.getByPlaceholderText("PROJ-123"));
    const input = screen.getByPlaceholderText("PROJ-123");
    fireEvent.change(input, { target: { value: "PROJ-5" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() =>
      expect(mockInvoke).toHaveBeenCalledWith("timer_start", { issueId: "PROJ-5" }),
    );
  });

  it("multiple active timers all show active indicator", async () => {
    const now = new Date().toISOString();
    setupToday([
      { issue_id: "PROJ-1", seconds: 0, active_since: now },
      { issue_id: "PROJ-2", seconds: 0, active_since: now },
      { issue_id: "PROJ-3", seconds: 120 },
    ]);
    render(<TimerWidget />);
    await waitFor(() => screen.getByText("PROJ-1"));
    expect(screen.getAllByText("●").length).toBe(2);
    expect(screen.getAllByText("⏸").length).toBe(2);
    expect(screen.getAllByText("▶").length).toBe(1);
  });

  it("subscribes to timer.updated", async () => {
    setupToday([]);
    render(<TimerWidget />);
    await waitFor(() =>
      expect(listen).toHaveBeenCalledWith("timer.updated", expect.any(Function)),
    );
  });
});
