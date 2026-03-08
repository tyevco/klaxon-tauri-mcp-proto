import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { FormWidget } from "../widgets/FormWidget";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

// Capture event listeners so tests can fire them
const eventListeners: Record<string, (e: any) => void> = {};
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn((event: string, handler: (e: any) => void) => {
    eventListeners[event] = handler;
    return Promise.resolve(() => {});
  }),
}));

const mockInvoke = vi.mocked(invoke);

const singlePageItem = {
  id: "aaaaaaaa-0000-0000-0000-000000000001",
  title: "My Form",
  message: "",
  level: "info",
  status: "open",
  created_at: new Date().toISOString(),
  form: {
    id: "f1",
    title: "My Form",
    description: "Please fill in.",
    fields: [
      { id: "name", type: "text", label: "Your name", required: true },
      { id: "score", type: "rating", label: "Rating", min: 1, max: 5 },
    ],
  },
};

const multiPageItem = {
  id: "aaaaaaaa-0000-0000-0000-000000000002",
  title: "Wizard",
  message: "",
  level: "info",
  status: "open",
  created_at: new Date().toISOString(),
  form: {
    id: "f2",
    title: "Wizard Form",
    description: "",
    fields: [],
    pages: [
      {
        id: "p1",
        title: "Step 1",
        fields: [{ id: "name", type: "text", label: "Name", required: true }],
        next: { kind: "fixed", page_id: "p2" },
      },
      {
        id: "p2",
        title: "Step 2",
        fields: [{ id: "note", type: "textarea", label: "Note" }],
        next: { kind: "end" },
      },
    ],
  },
};

const conditionalItem = {
  id: "aaaaaaaa-0000-0000-0000-000000000003",
  title: "Conditional",
  message: "",
  level: "info",
  status: "open",
  created_at: new Date().toISOString(),
  form: {
    id: "f3",
    title: "Conditional Form",
    description: "",
    fields: [],
    pages: [
      {
        id: "p1",
        title: "Choose",
        fields: [
          {
            id: "path",
            type: "radio",
            label: "Which way?",
            options: [{ value: "a", label: "Option A" }, { value: "b", label: "Option B" }],
          },
        ],
        next: {
          kind: "conditional",
          field_id: "path",
          branches: [
            { value: "a", page_id: "pa" },
            { value: "b", page_id: "pb" },
          ],
        },
      },
      {
        id: "pa",
        title: "Path A",
        fields: [{ id: "detail_a", type: "text", label: "Detail A" }],
        next: { kind: "end" },
      },
      {
        id: "pb",
        title: "Path B",
        fields: [{ id: "detail_b", type: "text", label: "Detail B" }],
        next: { kind: "end" },
      },
    ],
  },
};

async function fireFormOpen(item: object) {
  mockInvoke.mockResolvedValueOnce(item);
  await eventListeners["form.open"]?.({ payload: { id: (item as any).id } });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockInvoke.mockResolvedValue(null);
});

describe("FormWidget", () => {
  it("shows empty state before any form is opened", async () => {
    render(<FormWidget />);
    await waitFor(() => expect(screen.getByText("No active form.")).toBeInTheDocument());
  });

  it("listens for form.open and klaxon.answered events", async () => {
    render(<FormWidget />);
    await waitFor(() => {
      expect(listen).toHaveBeenCalledWith("form.open", expect.any(Function));
      expect(listen).toHaveBeenCalledWith("klaxon.answered", expect.any(Function));
    });
  });

  it("loads and renders a single-page form", async () => {
    render(<FormWidget />);
    await waitFor(() => screen.getByText("No active form."));

    await fireFormOpen(singlePageItem);

    await waitFor(() => expect(screen.getByText("Your name")).toBeInTheDocument());
    expect(screen.getByText("Rating")).toBeInTheDocument();
    expect(screen.getByText("Please fill in.")).toBeInTheDocument();
  });

  it("submit validates required fields and shows error", async () => {
    render(<FormWidget />);
    await waitFor(() => screen.getByText("No active form."));
    await fireFormOpen(singlePageItem);
    await waitFor(() => screen.getByText("Your name"));

    fireEvent.click(screen.getByText("Submit"));
    await waitFor(() => expect(screen.getByText("Required")).toBeInTheDocument());
    expect(mockInvoke).not.toHaveBeenCalledWith("klaxon_answer", expect.anything());
  });

  it("submit calls klaxon_answer then hide_panel", async () => {
    mockInvoke.mockResolvedValue(null);
    render(<FormWidget />);
    await waitFor(() => screen.getByText("No active form."));
    await fireFormOpen(singlePageItem);
    await waitFor(() => screen.getByText("Your name"));

    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "Alice" } });
    fireEvent.click(screen.getByText("Submit"));

    await waitFor(() =>
      expect(mockInvoke).toHaveBeenCalledWith("klaxon_answer", {
        id: singlePageItem.id,
        response: expect.objectContaining({ name: "Alice" }),
      }),
    );
    expect(mockInvoke).toHaveBeenCalledWith("hide_panel", { label: "form" });
  });

  it("cancel calls hide_panel", async () => {
    render(<FormWidget />);
    await waitFor(() => screen.getByText("No active form."));
    await fireFormOpen(singlePageItem);
    await waitFor(() => screen.getByText("Cancel"));

    fireEvent.click(screen.getByText("Cancel"));
    await waitFor(() =>
      expect(mockInvoke).toHaveBeenCalledWith("hide_panel", { label: "form" }),
    );
  });

  it("multi-page wizard shows Next and navigates to page 2", async () => {
    render(<FormWidget />);
    await waitFor(() => screen.getByText("No active form."));
    await fireFormOpen(multiPageItem);
    await waitFor(() => screen.getByText("Step 1"));

    expect(screen.getByText("Next →")).toBeInTheDocument();
    expect(screen.queryByText("Back")).not.toBeInTheDocument();

    // fill required name field then go next
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Bob" } });
    fireEvent.click(screen.getByText("Next →"));

    await waitFor(() => expect(screen.getByText("Step 2")).toBeInTheDocument());
    expect(screen.getByText("Back")).toBeInTheDocument();
  });

  it("Back button returns to previous page", async () => {
    render(<FormWidget />);
    await waitFor(() => screen.getByText("No active form."));
    await fireFormOpen(multiPageItem);
    await waitFor(() => screen.getByText("Step 1"));

    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Bob" } });
    fireEvent.click(screen.getByText("Next →"));
    await waitFor(() => screen.getByText("Step 2"));

    fireEvent.click(screen.getByText("Back"));
    await waitFor(() => expect(screen.getByText("Step 1")).toBeInTheDocument());
    expect(screen.queryByText("Back")).not.toBeInTheDocument();
  });

  it("progress dots shown for linear multi-page form", async () => {
    render(<FormWidget />);
    await waitFor(() => screen.getByText("No active form."));
    await fireFormOpen(multiPageItem);
    await waitFor(() => screen.getByText("Step 1 of 2"));
  });

  it("conditional branching navigates to correct page", async () => {
    render(<FormWidget />);
    await waitFor(() => screen.getByText("No active form."));
    await fireFormOpen(conditionalItem);
    await waitFor(() => screen.getByText("Choose"));

    // select Option B
    const radios = screen.getAllByRole("radio");
    fireEvent.click(radios[1]); // "Option B"
    fireEvent.click(screen.getByText("Next →"));

    await waitFor(() => expect(screen.getByText("Path B")).toBeInTheDocument());
    expect(screen.queryByText("Path A")).not.toBeInTheDocument();
  });

  it("resets to empty when klaxon.answered fires for active item", async () => {
    render(<FormWidget />);
    await waitFor(() => screen.getByText("No active form."));
    await fireFormOpen(singlePageItem);
    await waitFor(() => screen.getByText("Your name"));

    eventListeners["klaxon.answered"]?.({ payload: { id: singlePageItem.id } });
    await waitFor(() => expect(screen.getByText("No active form.")).toBeInTheDocument());
  });

  it("does not reset when klaxon.answered fires for a different item", async () => {
    render(<FormWidget />);
    await waitFor(() => screen.getByText("No active form."));
    await fireFormOpen(singlePageItem);
    await waitFor(() => screen.getByText("Your name"));

    eventListeners["klaxon.answered"]?.({ payload: { id: "different-id" } });
    await waitFor(() => expect(screen.getByText("Your name")).toBeInTheDocument());
  });
});
