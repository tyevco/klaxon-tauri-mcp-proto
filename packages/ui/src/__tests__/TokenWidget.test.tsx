import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { TokenWidget } from "../widgets/TokenWidget";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(() => Promise.resolve(() => {})),
}));

const mockInvoke = vi.mocked(invoke);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("TokenWidget", () => {
  it("renders empty state", async () => {
    mockInvoke.mockResolvedValue([]);
    render(<TokenWidget />);
    await waitFor(() => expect(screen.getByText("No token usage today.")).toBeInTheDocument());
  });

  it("renders model row with formatted token counts", async () => {
    mockInvoke.mockResolvedValue([
      { model: "claude-sonnet-4-6", input_tokens: 500, output_tokens: 200, cost_usd: 0.0 },
    ]);
    render(<TokenWidget />);
    await waitFor(() => expect(screen.getByText("claude-sonnet-4-6")).toBeInTheDocument());
    // "↑ 500" appears in model row; "↓ 200" appears in both model row and totals row
    expect(screen.getAllByText("↑ 500").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("↓ 200").length).toBeGreaterThanOrEqual(1);
  });

  it("renders grand total row summing all models", async () => {
    mockInvoke.mockResolvedValue([
      { model: "model-a", input_tokens: 1000, output_tokens: 400, cost_usd: 0.0 },
      { model: "model-b", input_tokens: 500, output_tokens: 100, cost_usd: 0.0 },
    ]);
    render(<TokenWidget />);
    await waitFor(() => expect(screen.getByText("model-a")).toBeInTheDocument());
    expect(screen.getByText("Total ↑ 1.5K")).toBeInTheDocument();
    expect(screen.getByText("↓ 500")).toBeInTheDocument();
  });

  it("renders cost when cost_usd is non-zero", async () => {
    mockInvoke.mockResolvedValue([
      { model: "claude-opus-4-6", input_tokens: 100, output_tokens: 50, cost_usd: 0.0042 },
    ]);
    render(<TokenWidget />);
    await waitFor(() => expect(screen.getByText("claude-opus-4-6")).toBeInTheDocument());
    // cost appears in both model row and totals row
    expect(screen.getAllByText("$0.0042").length).toBeGreaterThanOrEqual(1);
  });

  it("hides cost when cost_usd is zero", async () => {
    mockInvoke.mockResolvedValue([
      { model: "model-cheap", input_tokens: 10, output_tokens: 5, cost_usd: 0.0 },
    ]);
    render(<TokenWidget />);
    await waitFor(() => expect(screen.getByText("model-cheap")).toBeInTheDocument());
    expect(screen.queryByText(/\$0\.0000/)).not.toBeInTheDocument();
  });

  it("formats large counts as K/M", async () => {
    mockInvoke.mockResolvedValue([
      { model: "big-model", input_tokens: 2_500_000, output_tokens: 1_200_000, cost_usd: 0.0 },
    ]);
    render(<TokenWidget />);
    await waitFor(() => expect(screen.getByText("big-model")).toBeInTheDocument());
    // values appear in both model row and totals row
    expect(screen.getAllByText("↑ 2.5M").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("↓ 1.2M").length).toBeGreaterThanOrEqual(1);
  });

  it("subscribes to tokens.updated", async () => {
    mockInvoke.mockResolvedValue([]);
    render(<TokenWidget />);
    await waitFor(() =>
      expect(listen).toHaveBeenCalledWith("tokens.updated", expect.any(Function))
    );
  });
});
