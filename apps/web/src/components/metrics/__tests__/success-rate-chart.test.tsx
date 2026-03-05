import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { SuccessRateChart } from "../success-rate-chart";

// ---------------------------------------------------------------------------
// Mock: recharts — avoid canvas/SVG issues in jsdom
// ---------------------------------------------------------------------------
vi.mock("recharts", () => ({
  ResponsiveContainer: ({ children }: any) => (
    <div data-testid="responsive-container">{children}</div>
  ),
  LineChart: ({ children, data }: any) => (
    <div data-testid="line-chart" data-points={data?.length ?? 0}>
      {children}
    </div>
  ),
  Line: ({ dataKey }: any) => <div data-testid={`line-${dataKey}`} />,
  XAxis: () => <div data-testid="x-axis" />,
  YAxis: () => <div data-testid="y-axis" />,
  CartesianGrid: () => <div data-testid="cartesian-grid" />,
  Tooltip: () => <div data-testid="tooltip" />,
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

describe("SuccessRateChart", () => {
  it("renders without crashing with valid data", () => {
    const data = [
      makeDataPoint("2024-01-01T12:00:00Z", 8, 2),
      makeDataPoint("2024-01-01T12:01:00Z", 10, 0),
    ];

    const { container } = render(<SuccessRateChart data={data} />);
    expect(container).toBeTruthy();
  });

  it("renders chart components when data is provided", () => {
    const data = [
      makeDataPoint("2024-01-01T12:00:00Z", 8, 2),
    ];

    render(<SuccessRateChart data={data} />);

    expect(screen.getByTestId("responsive-container")).toBeInTheDocument();
    expect(screen.getByTestId("line-chart")).toBeInTheDocument();
    expect(screen.getByTestId("line-rate")).toBeInTheDocument();
  });

  it("shows empty state message when data is empty", () => {
    render(<SuccessRateChart data={[]} />);

    expect(screen.getByText("No data available")).toBeInTheDocument();
  });

  it("does not render chart when data is empty", () => {
    render(<SuccessRateChart data={[]} />);

    expect(
      screen.queryByTestId("responsive-container")
    ).not.toBeInTheDocument();
    expect(screen.queryByTestId("line-chart")).not.toBeInTheDocument();
  });

  it("passes formatted data with correct count to chart", () => {
    const data = [
      makeDataPoint("2024-01-01T12:00:00Z", 8, 2),
      makeDataPoint("2024-01-01T12:01:00Z", 10, 0),
      makeDataPoint("2024-01-01T12:02:00Z", 5, 5),
    ];

    render(<SuccessRateChart data={data} />);

    const chart = screen.getByTestId("line-chart");
    expect(chart).toHaveAttribute("data-points", "3");
  });

  it("renders axes and grid when data is present", () => {
    const data = [makeDataPoint("2024-01-01T12:00:00Z", 10, 0)];

    render(<SuccessRateChart data={data} />);

    expect(screen.getByTestId("x-axis")).toBeInTheDocument();
    expect(screen.getByTestId("y-axis")).toBeInTheDocument();
    expect(screen.getByTestId("cartesian-grid")).toBeInTheDocument();
  });

  it("renders tooltip component", () => {
    const data = [makeDataPoint("2024-01-01T12:00:00Z", 10, 0)];

    render(<SuccessRateChart data={data} />);

    expect(screen.getByTestId("tooltip")).toBeInTheDocument();
  });

  it("renders with single data point", () => {
    const data = [makeDataPoint("2024-01-01T12:00:00Z", 100, 0)];

    const { container } = render(<SuccessRateChart data={data} />);
    expect(container).toBeTruthy();
    expect(screen.getByTestId("line-chart")).toBeInTheDocument();
  });
});
