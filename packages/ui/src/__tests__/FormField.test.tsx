import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { FormFieldRenderer, validateField } from "../components/FormField";

// ── validateField ────────────────────────────────────────────────────────────

describe("validateField", () => {
  it("returns null for markdown type regardless of value", () => {
    expect(
      validateField({ type: "markdown", id: "m", label: "", content: "hi" }, undefined)
    ).toBeNull();
    expect(validateField({ type: "markdown", id: "m", label: "", content: "hi" }, "")).toBeNull();
  });

  it("returns Required for empty required text field", () => {
    expect(validateField({ type: "text", id: "x", label: "X", required: true }, "")).toBe(
      "Required"
    );
    expect(validateField({ type: "text", id: "x", label: "X", required: true }, undefined)).toBe(
      "Required"
    );
  });

  it("returns null when required field has value", () => {
    expect(
      validateField({ type: "text", id: "x", label: "X", required: true }, "hello")
    ).toBeNull();
  });

  it("validates min_len / max_len on text", () => {
    const field = { type: "text" as const, id: "x", label: "X", min_len: 3, max_len: 6 };
    expect(validateField(field, "ab")).toBe("Min length 3");
    expect(validateField(field, "toolong")).toBe("Max length 6");
    expect(validateField(field, "ok!")).toBeNull();
  });

  it("validates pattern on text", () => {
    const field = { type: "text" as const, id: "x", label: "X", pattern: "^\\d+$" };
    expect(validateField(field, "abc")).toBe("Does not match pattern");
    expect(validateField(field, "123")).toBeNull();
  });

  it("validates number min/max", () => {
    const field = { type: "number" as const, id: "n", label: "N", min: 1, max: 10 };
    expect(validateField(field, 0)).toBe("Min 1");
    expect(validateField(field, 11)).toBe("Max 10");
    expect(validateField(field, "notanumber")).toBe("Must be a number");
    expect(validateField(field, 5)).toBeNull();
  });

  it("returns null for non-required empty field", () => {
    expect(validateField({ type: "text", id: "x", label: "X" }, "")).toBeNull();
  });
});

// ── FormFieldRenderer ────────────────────────────────────────────────────────

describe("FormFieldRenderer", () => {
  it("renders text input", () => {
    render(
      <FormFieldRenderer
        field={{ type: "text", id: "t", label: "Name" }}
        value=""
        onChange={vi.fn()}
      />
    );
    expect(screen.getByText("Name")).toBeInTheDocument();
    expect(screen.getByRole("textbox")).toBeInTheDocument();
  });

  it("calls onChange for text input", () => {
    const onChange = vi.fn();
    render(
      <FormFieldRenderer
        field={{ type: "text", id: "t", label: "Name" }}
        value=""
        onChange={onChange}
      />
    );
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Alice" } });
    expect(onChange).toHaveBeenCalledWith("Alice");
  });

  it("renders textarea", () => {
    render(
      <FormFieldRenderer
        field={{ type: "textarea", id: "ta", label: "Notes" }}
        value=""
        onChange={vi.fn()}
      />
    );
    expect(screen.getByRole("textbox")).toBeInTheDocument();
  });

  it("renders select with options", () => {
    const field = {
      type: "select" as const,
      id: "s",
      label: "Color",
      options: [{ value: "red", label: "Red" }],
    };
    render(<FormFieldRenderer field={field} value="" onChange={vi.fn()} />);
    expect(screen.getByText("Red")).toBeInTheDocument();
  });

  it("renders radio options", () => {
    const field = {
      type: "radio" as const,
      id: "r",
      label: "Pick",
      options: [
        { value: "a", label: "A" },
        { value: "b", label: "B" },
      ],
    };
    render(<FormFieldRenderer field={field} value="" onChange={vi.fn()} />);
    expect(screen.getAllByRole("radio")).toHaveLength(2);
  });

  it("renders checkbox", () => {
    render(
      <FormFieldRenderer
        field={{ type: "checkbox", id: "c", label: "Agree" }}
        value={false}
        onChange={vi.fn()}
      />
    );
    expect(screen.getByRole("checkbox")).toBeInTheDocument();
  });

  it("renders required asterisk", () => {
    render(
      <FormFieldRenderer
        field={{ type: "text", id: "t", label: "Name", required: true }}
        value=""
        onChange={vi.fn()}
      />
    );
    expect(screen.getByText("*")).toBeInTheDocument();
  });

  it("renders error message", () => {
    render(
      <FormFieldRenderer
        field={{ type: "text", id: "t", label: "Name" }}
        value=""
        error="Required"
        onChange={vi.fn()}
      />
    );
    expect(screen.getByText("Required")).toBeInTheDocument();
  });

  it("renders rating stars", () => {
    const onChange = vi.fn();
    render(
      <FormFieldRenderer
        field={{ type: "rating", id: "r", label: "Score", min: 1, max: 5 }}
        value={3}
        onChange={onChange}
      />
    );
    const stars = screen.getAllByText(/[★☆]/);
    expect(stars).toHaveLength(5);
    // Click 4th star
    fireEvent.click(stars[3]);
    expect(onChange).toHaveBeenCalledWith(4);
  });

  it("renders slider with live readout", () => {
    const onChange = vi.fn();
    render(
      <FormFieldRenderer
        field={{ type: "slider", id: "s", label: "Volume", min: 0, max: 100, step: 1 }}
        value={42}
        onChange={onChange}
      />
    );
    expect(screen.getByText("42")).toBeInTheDocument();
    const slider = screen.getByRole("slider");
    fireEvent.change(slider, { target: { value: "70" } });
    expect(onChange).toHaveBeenCalledWith(70);
  });

  it("renders markdown content without onChange", () => {
    render(
      <FormFieldRenderer
        field={{ type: "markdown", id: "m", label: "", content: "**hello**" }}
        value={undefined}
        onChange={vi.fn()}
      />
    );
    expect(screen.getByText("hello")).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("renders unsupported type fallback", () => {
    render(
      <FormFieldRenderer
        field={{ type: "datetime", id: "d", label: "When" }}
        value=""
        onChange={vi.fn()}
      />
    );
    const input = document.querySelector('input[type="datetime-local"]');
    expect(input).not.toBeNull();
  });
});
