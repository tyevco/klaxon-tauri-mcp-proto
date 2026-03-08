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
vi.mock("../widgets/HistoryWidget", () => ({
  HistoryWidget: () => <div data-testid="history-widget" />,
}));
vi.mock("../widgets/TimerReportWidget", () => ({
  TimerReportWidget: () => <div data-testid="timer-report-widget" />,
}));
vi.mock("../widgets/BudgetWidget", () => ({
  BudgetWidget: () => <div data-testid="budget-widget" />,
}));
vi.mock("../widgets/AgentsWidget", () => ({
  AgentsWidget: () => <div data-testid="agents-widget" />,
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

  it("?panel=history renders HistoryWidget", () => {
    window.location = { search: "?panel=history" } as any;
    render(<App />);
    expect(screen.getByTestId("history-widget")).toBeInTheDocument();
  });

  it("?panel=timer-report renders TimerReportWidget", () => {
    window.location = { search: "?panel=timer-report" } as any;
    render(<App />);
    expect(screen.getByTestId("timer-report-widget")).toBeInTheDocument();
  });

  it("?panel=budget renders BudgetWidget", () => {
    window.location = { search: "?panel=budget" } as any;
    render(<App />);
    expect(screen.getByTestId("budget-widget")).toBeInTheDocument();
  });

  it("?panel=agents renders AgentsWidget", () => {
    window.location = { search: "?panel=agents" } as any;
    render(<App />);
    expect(screen.getByTestId("agents-widget")).toBeInTheDocument();
  });

  it("?panel=unknown falls back to KlaxonWidget", () => {
    window.location = { search: "?panel=unknown" } as any;
    render(<App />);
    expect(screen.getByTestId("klaxon-widget")).toBeInTheDocument();
  });
});
