import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { App } from "../App";

vi.mock("../widgets/KlaxonWidget", () => ({
  KlaxonWidget: () => <div data-testid="klaxon-widget" />,
}));
vi.mock("../widgets/TimerWidget", () => ({
  TimerWidget: () => <div data-testid="timer-widget" />,
}));
vi.mock("../widgets/TokenWidget", () => ({
  TokenWidget: () => <div data-testid="token-widget" />,
}));
vi.mock("../widgets/FormWidget", () => ({
  FormWidget: () => <div data-testid="form-widget" />,
}));

beforeEach(() => {
  Object.defineProperty(window, "location", {
    writable: true,
    configurable: true,
    value: { search: "" },
  });
});

describe("App panel routing", () => {
  it("no param renders KlaxonWidget", () => {
    render(<App />);
    expect(screen.getByTestId("klaxon-widget")).toBeInTheDocument();
  });

  it("?panel=klaxon renders KlaxonWidget", () => {
    window.location = { search: "?panel=klaxon" } as any;
    render(<App />);
    expect(screen.getByTestId("klaxon-widget")).toBeInTheDocument();
  });

  it("?panel=timer renders TimerWidget", () => {
    window.location = { search: "?panel=timer" } as any;
    render(<App />);
    expect(screen.getByTestId("timer-widget")).toBeInTheDocument();
  });

  it("?panel=tokens renders TokenWidget", () => {
    window.location = { search: "?panel=tokens" } as any;
    render(<App />);
    expect(screen.getByTestId("token-widget")).toBeInTheDocument();
  });

  it("?panel=form renders FormWidget", () => {
    window.location = { search: "?panel=form" } as any;
    render(<App />);
    expect(screen.getByTestId("form-widget")).toBeInTheDocument();
  });

  it("?panel=unknown falls back to KlaxonWidget", () => {
    window.location = { search: "?panel=unknown" } as any;
    render(<App />);
    expect(screen.getByTestId("klaxon-widget")).toBeInTheDocument();
  });
});
