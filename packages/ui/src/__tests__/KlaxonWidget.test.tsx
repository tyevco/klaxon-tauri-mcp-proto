import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { KlaxonWidget } from "../widgets/KlaxonWidget";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(() => Promise.resolve(() => {})),
}));

const mockInvoke = vi.mocked(invoke);

const baseItem = {
  id: "550e8400-e29b-41d4-a716-446655440000",
  title: "Test Alert",
  message: "Something happened",
  level: "info",
  status: "open",
  created_at: new Date().toISOString(),
};

const formItem = {
  ...baseItem,
  id: "550e8400-e29b-41d4-a716-446655440001",
  title: "Question",
  form: {
    id: "form1",
    title: "Ask",
    fields: [{ id: "name", type: "text", label: "Your name", required: true }],
  },
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("KlaxonWidget", () => {
  it("renders empty state", async () => {
    mockInvoke.mockResolvedValue([]);
    render(<KlaxonWidget />);
    await waitFor(() => expect(screen.getByText("No active klaxons.")).toBeInTheDocument());
    expect(mockInvoke).toHaveBeenCalledWith("klaxon_list_open");
  });

  it("renders item card", async () => {
    mockInvoke.mockResolvedValue([baseItem]);
    render(<KlaxonWidget />);
    await waitFor(() => expect(screen.getByText("Test Alert")).toBeInTheDocument());
    expect(screen.getByText("Something happened")).toBeInTheDocument();
    expect(screen.getByText("1 open")).toBeInTheDocument();
  });

  it("ack button calls klaxon_ack and refreshes", async () => {
    mockInvoke.mockResolvedValueOnce([baseItem]).mockResolvedValue([]);
    render(<KlaxonWidget />);
    await waitFor(() => screen.getByText("Test Alert"));
    fireEvent.click(screen.getAllByText("Ack")[0]);
    await waitFor(() => expect(mockInvoke).toHaveBeenCalledWith("klaxon_ack", { id: baseItem.id }));
    await waitFor(() => expect(mockInvoke).toHaveBeenCalledWith("klaxon_list_open"));
  });

  it("dismiss button calls klaxon_dismiss and refreshes", async () => {
    mockInvoke.mockResolvedValueOnce([baseItem]).mockResolvedValue([]);
    render(<KlaxonWidget />);
    await waitFor(() => screen.getByText("Test Alert"));
    fireEvent.click(screen.getAllByText("Dismiss")[0]);
    await waitFor(() =>
      expect(mockInvoke).toHaveBeenCalledWith("klaxon_dismiss", { id: baseItem.id })
    );
  });

  it("renders Open Form button when item has a form", async () => {
    mockInvoke.mockResolvedValue([formItem]);
    render(<KlaxonWidget />);
    await waitFor(() => expect(screen.getByText("Open Form")).toBeInTheDocument());
    expect(screen.queryByText("Your name")).not.toBeInTheDocument();
  });

  it("Open Form button calls klaxon_open_form with item id", async () => {
    mockInvoke.mockResolvedValue([formItem]);
    render(<KlaxonWidget />);
    await waitFor(() => screen.getByText("Open Form"));
    fireEvent.click(screen.getByText("Open Form"));
    await waitFor(() =>
      expect(mockInvoke).toHaveBeenCalledWith("klaxon_open_form", { id: formItem.id })
    );
  });

  it("shows Answered label for answered form items", async () => {
    const answeredItem = { ...formItem, status: "answered" };
    mockInvoke.mockResolvedValue([answeredItem]);
    render(<KlaxonWidget />);
    await waitFor(() => expect(screen.getByText("Answered")).toBeInTheDocument());
    expect(screen.queryByText("Open Form")).not.toBeInTheDocument();
  });

  it("refresh button calls klaxon_list_open again", async () => {
    mockInvoke.mockResolvedValue([]);
    render(<KlaxonWidget />);
    await waitFor(() => screen.getByText("Refresh"));
    fireEvent.click(screen.getByText("Refresh"));
    await waitFor(() => expect(mockInvoke).toHaveBeenCalledTimes(2));
    expect(mockInvoke).toHaveBeenNthCalledWith(2, "klaxon_list_open");
  });

  it("subscribes to klaxon.updated and klaxon.created events", async () => {
    mockInvoke.mockResolvedValue([]);
    render(<KlaxonWidget />);
    await waitFor(() =>
      expect(listen).toHaveBeenCalledWith("klaxon.updated", expect.any(Function))
    );
    expect(listen).toHaveBeenCalledWith("klaxon.created", expect.any(Function));
  });
});
