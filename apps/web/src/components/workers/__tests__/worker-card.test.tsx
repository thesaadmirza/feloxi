import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { WorkerCard } from "../worker-card";

// ---------------------------------------------------------------------------
// Mock: next/link
// ---------------------------------------------------------------------------
vi.mock("next/link", () => ({
  __esModule: true,
  default: ({
    href,
    children,
    ...rest
  }: {
    href: string;
    children: React.ReactNode;
  }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const defaultProps = {
  workerId: "celery@worker-host-1",
  hostname: "worker-host-1",
  status: "online",
  activeTasks: 5,
  cpuPercent: 45.678,
  memoryMb: 512.345,
  poolSize: 8,
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("WorkerCard", () => {
  it("renders worker hostname", () => {
    render(<WorkerCard {...defaultProps} />);

    expect(screen.getByText("worker-host-1")).toBeInTheDocument();
  });

  it("shows Online indicator for online status", () => {
    render(<WorkerCard {...defaultProps} status="online" />);

    expect(screen.getByText("Online")).toBeInTheDocument();
  });

  it("shows Online indicator for worker-heartbeat status", () => {
    render(<WorkerCard {...defaultProps} status="worker-heartbeat" />);

    expect(screen.getByText("Online")).toBeInTheDocument();
  });

  it("shows Online indicator for worker-online status", () => {
    render(<WorkerCard {...defaultProps} status="worker-online" />);

    expect(screen.getByText("Online")).toBeInTheDocument();
  });

  it("shows Offline indicator for non-online statuses", () => {
    render(<WorkerCard {...defaultProps} status="worker-offline" />);

    expect(screen.getByText("Offline")).toBeInTheDocument();
  });

  it("shows Offline for an arbitrary unknown status", () => {
    render(<WorkerCard {...defaultProps} status="something-else" />);

    expect(screen.getByText("Offline")).toBeInTheDocument();
  });

  it("displays active tasks count", () => {
    render(<WorkerCard {...defaultProps} activeTasks={12} />);

    expect(screen.getByText("12 active")).toBeInTheDocument();
  });

  it("displays CPU percentage formatted to one decimal", () => {
    render(<WorkerCard {...defaultProps} cpuPercent={45.678} />);

    expect(screen.getByText("45.7% CPU")).toBeInTheDocument();
  });

  it("displays memory in MB formatted to integer", () => {
    render(<WorkerCard {...defaultProps} memoryMb={512.789} />);

    expect(screen.getByText("513 MB")).toBeInTheDocument();
  });

  it("displays pool size", () => {
    render(<WorkerCard {...defaultProps} poolSize={16} />);

    expect(screen.getByText("Pool: 16")).toBeInTheDocument();
  });

  it("links to the worker detail page", () => {
    render(<WorkerCard {...defaultProps} workerId="celery@worker-host-1" />);

    const link = screen.getByRole("link");
    expect(link).toHaveAttribute(
      "href",
      "/workers/celery%40worker-host-1"
    );
  });

  it("shows Shutdown button when onShutdown is provided and worker is online", async () => {
    const onShutdown = vi.fn();
    render(
      <WorkerCard {...defaultProps} status="online" onShutdown={onShutdown} />
    );

    const shutdownBtn = screen.getByText("Shutdown");
    expect(shutdownBtn).toBeInTheDocument();

    await userEvent.click(shutdownBtn);
    expect(onShutdown).toHaveBeenCalledOnce();
  });

  it("does not show Shutdown button when worker is offline even if onShutdown is provided", () => {
    const onShutdown = vi.fn();
    render(
      <WorkerCard
        {...defaultProps}
        status="worker-offline"
        onShutdown={onShutdown}
      />
    );

    expect(screen.queryByText("Shutdown")).not.toBeInTheDocument();
  });

  it("does not show Shutdown button when onShutdown is not provided", () => {
    render(<WorkerCard {...defaultProps} status="online" />);

    expect(screen.queryByText("Shutdown")).not.toBeInTheDocument();
  });

  it("displays zero active tasks", () => {
    render(<WorkerCard {...defaultProps} activeTasks={0} />);

    expect(screen.getByText("0 active")).toBeInTheDocument();
  });

  it("displays zero CPU", () => {
    render(<WorkerCard {...defaultProps} cpuPercent={0} />);

    expect(screen.getByText("0.0% CPU")).toBeInTheDocument();
  });
});
