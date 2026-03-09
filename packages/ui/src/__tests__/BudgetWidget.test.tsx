import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { BudgetWidget } from "../widgets/BudgetWidget";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(() => Promise.resolve(() => {})),
}));

const mockInvoke = vi.mocked(invoke);

const today = new Date().toISOString().slice(0, 10);
const noopSettings = { theme: "dark", mcp_preferred_port: 0, budget_usd_daily: 0 };

beforeEach(() => {
  vi.clearAllMocks();
});

describe("BudgetWidget", () => {
  it("shows $0.0000 when no token data and no budget", async () => {
    mockInvoke.mockImplementation(cmd => {
      if (cmd === "tokens_week") return Promise.resolve([]);
      if (cmd === "settings_get") return Promise.resolve(noopSettings);
      return Promise.resolve(null);
    });
    render(<BudgetWidget />);
    await waitFor(() => expect(screen.getByText("$0.0000")).toBeInTheDocument());
  });

  it("shows 'no budget set' when budget is zero", async () => {
    mockInvoke.mockImplementation(cmd => {
      if (cmd === "tokens_week") return Promise.resolve([]);
      if (cmd === "settings_get") return Promise.resolve(noopSettings);
      return Promise.resolve(null);
    });
    render(<BudgetWidget />);
    await waitFor(() => expect(screen.getByText("no budget set")).toBeInTheDocument());
  });

  it("shows budget percentage when budget is set", async () => {
    mockInvoke.mockImplementation(cmd => {
      if (cmd === "tokens_week")
        return Promise.resolve([{ date: today, cost_usd: 2.5, input_tokens: 0, output_tokens: 0 }]);
      if (cmd === "settings_get")
        return Promise.resolve({ ...noopSettings, budget_usd_daily: 10.0 });
      return Promise.resolve(null);
    });
    render(<BudgetWidget />);
    await waitFor(() => expect(screen.getByText(/25%/)).toBeInTheDocument());
  });

  it("shows today's cost", async () => {
    mockInvoke.mockImplementation(cmd => {
      if (cmd === "tokens_week")
        return Promise.resolve([{ date: today, cost_usd: 1.5, input_tokens: 0, output_tokens: 0 }]);
      if (cmd === "settings_get") return Promise.resolve(noopSettings);
      return Promise.resolve(null);
    });
    render(<BudgetWidget />);
    await waitFor(() => expect(screen.getByText("$1.50")).toBeInTheDocument());
  });

  it("shows Set budget button when no budget", async () => {
    mockInvoke.mockImplementation(cmd => {
      if (cmd === "tokens_week") return Promise.resolve([]);
      if (cmd === "settings_get") return Promise.resolve(noopSettings);
      return Promise.resolve(null);
    });
    render(<BudgetWidget />);
    await waitFor(() => expect(screen.getByText("Set budget")).toBeInTheDocument());
  });

  it("shows Edit budget button when budget is set", async () => {
    mockInvoke.mockImplementation(cmd => {
      if (cmd === "tokens_week") return Promise.resolve([]);
      if (cmd === "settings_get")
        return Promise.resolve({ ...noopSettings, budget_usd_daily: 5.0 });
      return Promise.resolve(null);
    });
    render(<BudgetWidget />);
    await waitFor(() => expect(screen.getByText("Edit budget")).toBeInTheDocument());
  });

  it("opens budget input on button click", async () => {
    mockInvoke.mockImplementation(cmd => {
      if (cmd === "tokens_week") return Promise.resolve([]);
      if (cmd === "settings_get") return Promise.resolve(noopSettings);
      return Promise.resolve(null);
    });
    render(<BudgetWidget />);
    await waitFor(() => expect(screen.getByText("Set budget")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Set budget"));
    expect(screen.getByPlaceholderText("Daily budget ($)")).toBeInTheDocument();
  });

  it("saves budget on Save click", async () => {
    mockInvoke.mockImplementation(cmd => {
      if (cmd === "tokens_week") return Promise.resolve([]);
      if (cmd === "settings_get") return Promise.resolve(noopSettings);
      if (cmd === "settings_set") return Promise.resolve(null);
      return Promise.resolve(null);
    });
    render(<BudgetWidget />);
    await waitFor(() => expect(screen.getByText("Set budget")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Set budget"));
    fireEvent.change(screen.getByPlaceholderText("Daily budget ($)"), { target: { value: "10" } });
    fireEvent.click(screen.getByText("Save"));
    await waitFor(() =>
      expect(mockInvoke).toHaveBeenCalledWith("settings_set", {
        settings: { ...noopSettings, budget_usd_daily: 10 },
      })
    );
  });

  it("subscribes to tokens.updated and settings.changed", async () => {
    mockInvoke.mockImplementation(cmd => {
      if (cmd === "tokens_week") return Promise.resolve([]);
      if (cmd === "settings_get") return Promise.resolve(noopSettings);
      return Promise.resolve(null);
    });
    render(<BudgetWidget />);
    await waitFor(() => {
      expect(listen).toHaveBeenCalledWith("tokens.updated", expect.any(Function));
      expect(listen).toHaveBeenCalledWith("settings.changed", expect.any(Function));
    });
  });
});
