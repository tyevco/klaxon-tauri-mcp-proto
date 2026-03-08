import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { HistoryWidget } from "../widgets/HistoryWidget";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(() => Promise.resolve(() => {})),
}));

const mockInvoke = vi.mocked(invoke);

const today = new Date().toISOString();

const sampleItems = [
  { id: "1", title: "Build failed", message: "TypeScript error", level: "error", status: "open", created_at: today },
  { id: "2", title: "Code review", message: "Please approve", level: "info", status: "answered", created_at: today, response: { decision: "approved" } },
  { id: "3", title: "Old warning", message: "Something happened", level: "warning", status: "dismissed", created_at: "2020-01-01T00:00:00Z" },
];

beforeEach(() => {
  vi.clearAllMocks();
});

describe("HistoryWidget", () => {
  it("renders empty state", async () => {
    mockInvoke.mockResolvedValue([]);
    render(<HistoryWidget />);
    await waitFor(() => expect(screen.getByText("No items.")).toBeInTheDocument());
  });

  it("renders item titles", async () => {
    mockInvoke.mockResolvedValue(sampleItems);
    render(<HistoryWidget />);
    await waitFor(() => expect(screen.getByText("Build failed")).toBeInTheDocument());
    expect(screen.getByText("Code review")).toBeInTheDocument();
    expect(screen.getByText("Old warning")).toBeInTheDocument();
  });

  it("shows status chip for each item", async () => {
    mockInvoke.mockResolvedValue(sampleItems);
    render(<HistoryWidget />);
    await waitFor(() => expect(screen.getByText("Build failed")).toBeInTheDocument());
    expect(screen.getByText("answered")).toBeInTheDocument();
    expect(screen.getByText("dismissed")).toBeInTheDocument();
  });

  it("expands item on click to show message", async () => {
    mockInvoke.mockResolvedValue(sampleItems);
    render(<HistoryWidget />);
    await waitFor(() => expect(screen.getByText("Build failed")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Build failed").closest("div")!);
    await waitFor(() => expect(screen.getByText("TypeScript error")).toBeInTheDocument());
  });

  it("collapses expanded item on second click", async () => {
    mockInvoke.mockResolvedValue(sampleItems);
    render(<HistoryWidget />);
    await waitFor(() => expect(screen.getByText("Build failed")).toBeInTheDocument());
    const card = screen.getByText("Build failed").closest("div")!;
    fireEvent.click(card);
    await waitFor(() => expect(screen.getByText("TypeScript error")).toBeInTheDocument());
    fireEvent.click(card);
    await waitFor(() => expect(screen.queryByText("TypeScript error")).not.toBeInTheDocument());
  });

  it("filters by status", async () => {
    mockInvoke.mockResolvedValue(sampleItems);
    render(<HistoryWidget />);
    await waitFor(() => expect(screen.getByText("Build failed")).toBeInTheDocument());
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "answered" } });
    await waitFor(() => expect(screen.queryByText("Build failed")).not.toBeInTheDocument());
    expect(screen.getByText("Code review")).toBeInTheDocument();
  });

  it("filters by text search", async () => {
    mockInvoke.mockResolvedValue(sampleItems);
    render(<HistoryWidget />);
    await waitFor(() => expect(screen.getByText("Build failed")).toBeInTheDocument());
    fireEvent.change(screen.getByPlaceholderText("Search..."), { target: { value: "review" } });
    await waitFor(() => expect(screen.queryByText("Build failed")).not.toBeInTheDocument());
    expect(screen.getByText("Code review")).toBeInTheDocument();
  });

  it("filters to today only", async () => {
    mockInvoke.mockResolvedValue(sampleItems);
    render(<HistoryWidget />);
    await waitFor(() => expect(screen.getByText("Old warning")).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText(/today/i));
    await waitFor(() => expect(screen.queryByText("Old warning")).not.toBeInTheDocument());
    expect(screen.getByText("Build failed")).toBeInTheDocument();
  });

  it("subscribes to klaxon.created and klaxon.updated", async () => {
    mockInvoke.mockResolvedValue([]);
    render(<HistoryWidget />);
    await waitFor(() => {
      expect(listen).toHaveBeenCalledWith("klaxon.created", expect.any(Function));
      expect(listen).toHaveBeenCalledWith("klaxon.updated", expect.any(Function));
    });
  });

  it("calls klaxon_list_all with correct args", async () => {
    mockInvoke.mockResolvedValue([]);
    render(<HistoryWidget />);
    await waitFor(() =>
      expect(mockInvoke).toHaveBeenCalledWith("klaxon_list_all", { limit: 200, offset: 0 }),
    );
  });
});
