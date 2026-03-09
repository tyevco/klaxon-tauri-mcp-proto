import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { TimerReportWidget } from "../widgets/TimerReportWidget";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(() => Promise.resolve(() => {})),
}));

const mockInvoke = vi.mocked(invoke);

const today = new Date().toISOString().slice(0, 10);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("TimerReportWidget", () => {
  it("renders empty state", async () => {
    mockInvoke.mockResolvedValue([]);
    render(<TimerReportWidget />);
    await waitFor(() => expect(screen.getByText("No timer data this week.")).toBeInTheDocument());
  });

  it("renders issue row", async () => {
    mockInvoke.mockResolvedValue([{ issue_id: "PROJ-123", date: today, seconds: 3600 }]);
    render(<TimerReportWidget />);
    await waitFor(() => expect(screen.getByText("PROJ-123")).toBeInTheDocument());
  });

  it("formats seconds as hours", async () => {
    mockInvoke.mockResolvedValue([{ issue_id: "PROJ-123", date: today, seconds: 3600 }]);
    render(<TimerReportWidget />);
    await waitFor(() => expect(screen.getByText("PROJ-123")).toBeInTheDocument());
    expect(screen.getAllByText("1h").length).toBeGreaterThanOrEqual(1);
  });

  it("formats seconds as minutes", async () => {
    mockInvoke.mockResolvedValue([{ issue_id: "PROJ-456", date: today, seconds: 1800 }]);
    render(<TimerReportWidget />);
    await waitFor(() => expect(screen.getByText("PROJ-456")).toBeInTheDocument());
    expect(screen.getAllByText("30m").length).toBeGreaterThanOrEqual(1);
  });

  it("renders multiple issues", async () => {
    mockInvoke.mockResolvedValue([
      { issue_id: "PROJ-1", date: today, seconds: 3600 },
      { issue_id: "PROJ-2", date: today, seconds: 1800 },
    ]);
    render(<TimerReportWidget />);
    await waitFor(() => expect(screen.getByText("PROJ-1")).toBeInTheDocument());
    expect(screen.getByText("PROJ-2")).toBeInTheDocument();
  });

  it("shows Copy as text button", async () => {
    mockInvoke.mockResolvedValue([{ issue_id: "PROJ-1", date: today, seconds: 3600 }]);
    render(<TimerReportWidget />);
    await waitFor(() => expect(screen.getByText("Copy as text")).toBeInTheDocument());
  });

  it("subscribes to timer.updated", async () => {
    mockInvoke.mockResolvedValue([]);
    render(<TimerReportWidget />);
    await waitFor(() => expect(listen).toHaveBeenCalledWith("timer.updated", expect.any(Function)));
  });

  it("calls timer_week command", async () => {
    mockInvoke.mockResolvedValue([]);
    render(<TimerReportWidget />);
    await waitFor(() => expect(mockInvoke).toHaveBeenCalledWith("timer_week"));
  });
});
