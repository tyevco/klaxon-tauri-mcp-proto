import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { AgentsWidget } from "../widgets/AgentsWidget";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(() => Promise.resolve(() => {})),
}));

const mockInvoke = vi.mocked(invoke);

const now = new Date().toISOString();

beforeEach(() => {
  vi.clearAllMocks();
});

describe("AgentsWidget", () => {
  it("renders empty state", async () => {
    mockInvoke.mockResolvedValue([]);
    render(<AgentsWidget />);
    await waitFor(() =>
      expect(screen.getByText("No agents connected yet.")).toBeInTheDocument(),
    );
  });

  it("renders agent client_id", async () => {
    mockInvoke.mockResolvedValue([
      { client_id: "claude-agent-1", last_seen: now, last_tool: "klaxon.notify", calls_today: 5 },
    ]);
    render(<AgentsWidget />);
    await waitFor(() => expect(screen.getByText("claude-agent-1")).toBeInTheDocument());
  });

  it("renders last_tool", async () => {
    mockInvoke.mockResolvedValue([
      { client_id: "agent-x", last_seen: now, last_tool: "timer.start", calls_today: 3 },
    ]);
    render(<AgentsWidget />);
    await waitFor(() => expect(screen.getByText("timer.start")).toBeInTheDocument());
  });

  it("renders calls_today count", async () => {
    mockInvoke.mockResolvedValue([
      { client_id: "agent-y", last_seen: now, calls_today: 42 },
    ]);
    render(<AgentsWidget />);
    await waitFor(() => expect(screen.getByText("42 calls today")).toBeInTheDocument());
  });

  it("renders multiple agents", async () => {
    mockInvoke.mockResolvedValue([
      { client_id: "agent-a", last_seen: now, calls_today: 1 },
      { client_id: "agent-b", last_seen: now, calls_today: 2 },
    ]);
    render(<AgentsWidget />);
    await waitFor(() => expect(screen.getByText("agent-a")).toBeInTheDocument());
    expect(screen.getByText("agent-b")).toBeInTheDocument();
  });

  it("does not show last_tool when absent", async () => {
    mockInvoke.mockResolvedValue([
      { client_id: "agent-z", last_seen: now, calls_today: 0 },
    ]);
    render(<AgentsWidget />);
    await waitFor(() => expect(screen.getByText("agent-z")).toBeInTheDocument());
    expect(screen.queryByText(/Last:/)).not.toBeInTheDocument();
  });

  it("subscribes to agents.updated", async () => {
    mockInvoke.mockResolvedValue([]);
    render(<AgentsWidget />);
    await waitFor(() =>
      expect(listen).toHaveBeenCalledWith("agents.updated", expect.any(Function)),
    );
  });

  it("calls mcp_list_agents command", async () => {
    mockInvoke.mockResolvedValue([]);
    render(<AgentsWidget />);
    await waitFor(() => expect(mockInvoke).toHaveBeenCalledWith("mcp_list_agents"));
  });
});
