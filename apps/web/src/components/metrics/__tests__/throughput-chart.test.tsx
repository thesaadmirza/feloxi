import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ThroughputChart } from "../throughput-chart";

// ---------------------------------------------------------------------------
// Mock: recharts — avoid canvas/SVG issues in jsdom
// ---------------------------------------------------------------------------
vi.mock("recharts", () => ({
  ResponsiveContainer: ({ children }: any) => (
    <div data-testid="responsive-container">{children}</div>
  ),
  AreaChart: ({ children, data }: any) => (
    <div data-testid="area-chart" data-points={data?.length ?? 0}>
      {children}
    </div>
  ),
  Area: ({ dataKey, name }: any) => (
    <div data-testid={`area-${dataKey}`}>{name}</div>
  ),
  XAxis: () => <div data-testid="x-axis" />,
  YAxis: () => <div data-testid="y-axis" />,
  CartesianGrid: () => <div data-testid="cartesian-grid" />,
  Tooltip: () => <div data-testid="tooltip" />,
  Legend: () => <div data-testid="legend" />,
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDataPoint(minute: string, success: number, failure: number) {
  return {
    minute,
    success_count: success,
    failure_count: failure,
    total_count: success + failure,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ThroughputChart", () => {
  it("renders without crashing with valid data", () => {
    const data = [
      makeDataPoint("2024-01-01T12:00:00Z", 10, 2),
      makeDataPoint("2024-01-01T12:01:00Z", 15, 1),
    ];

    const { container } = render(<ThroughputChart data={data} />);
    expect(container).toBeTruthy();
  });

  it("renders the chart components when data is provided", () => {
    const data = [
      makeDataPoint("2024-01-01T12:00:00Z", 10, 2),
      makeDataPoint("2024-01-01T12:01:00Z", 15, 1),
    ];

    render(<ThroughputChart data={data} />);

    expect(screen.getByTestId("responsive-container")).toBeInTheDocument();
    expect(screen.getByTestId("area-chart")).toBeInTheDocument();
    expect(screen.getByTestId("area-success_count")).toBeInTheDocument();
    expect(screen.getByTestId("area-failure_count")).toBeInTheDocument();
  });

  it("shows empty state message when data is empty", () => {
    render(<ThroughputChart data={[]} />);

    expect(
      screen.getByText("No throughput data available")
    ).toBeInTheDocument();
  });

  it("does not render chart when data is empty", () => {
    render(<ThroughputChart data={[]} />);

    expect(
      screen.queryByTestId("responsive-container")
    ).not.toBeInTheDocument();
    expect(screen.queryByTestId("area-chart")).not.toBeInTheDocument();
  });

  it("renders Success and Failure area labels", () => {
    const data = [makeDataPoint("2024-01-01T12:00:00Z", 5, 3)];

    render(<ThroughputChart data={data} />);

    expect(screen.getByText("Success")).toBeInTheDocument();
    expect(screen.getByText("Failure")).toBeInTheDocument();
  });

  it("passes formatted data to chart", () => {
    const data = [
      makeDataPoint("2024-01-01T12:00:00Z", 10, 2),
      makeDataPoint("2024-01-01T12:01:00Z", 20, 5),
      makeDataPoint("2024-01-01T12:02:00Z", 30, 0),
    ];

    render(<ThroughputChart data={data} />);

    const chart = screen.getByTestId("area-chart");
    expect(chart).toHaveAttribute("data-points", "3");
  });

  it("renders axes and grid", () => {
    const data = [makeDataPoint("2024-01-01T12:00:00Z", 10, 2)];

    render(<ThroughputChart data={data} />);

    expect(screen.getByTestId("x-axis")).toBeInTheDocument();
    expect(screen.getByTestId("y-axis")).toBeInTheDocument();
    expect(screen.getByTestId("cartesian-grid")).toBeInTheDocument();
  });
});
