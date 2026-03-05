import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TaskTable } from "../task-table";
import type { TaskEvent } from "@/types/api";

// ---------------------------------------------------------------------------
// Mock: next/link — render a plain anchor so we can test href values
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

function makeTask(overrides: Partial<TaskEvent> = {}): TaskEvent {
  return {
    tenant_id: "t1",
    event_id: "evt-1",
    task_id: "abcdef1234567890",
    task_name: "send_email",
    queue: "default",
    worker_id: "worker-host-1234567890abcdef",
    state: "SUCCESS",
    event_type: "task-succeeded",
    timestamp: Date.now(),
    args: "[]",
    kwargs: "{}",
    result: '"ok"',
    exception: "",
    traceback: "",
    runtime: 1.23,
    retries: 0,
    root_id: null,
    parent_id: null,
    group_id: null,
    chord_id: null,
    agent_id: "agent-1",
    broker_type: "redis",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("TaskTable", () => {
  it("renders all table headers", () => {
    render(<TaskTable tasks={[makeTask()]} />);

    const expectedHeaders = [
      "Task ID",
      "Name",
      "State",
      "Queue",
      "Worker",
      "Runtime",
      "Time",
      "Actions",
    ];

    for (const header of expectedHeaders) {
      expect(screen.getByText(header)).toBeInTheDocument();
    }
  });

  it("renders task rows with correct data", () => {
    const task = makeTask({
      task_id: "abcdef1234567890",
      task_name: "process_order",
      state: "SUCCESS",
      queue: "high-priority",
      runtime: 2.5,
    });

    render(<TaskTable tasks={[task]} />);

    // Task name
    expect(screen.getByText("process_order")).toBeInTheDocument();

    // State badge
    expect(screen.getByText("SUCCESS")).toBeInTheDocument();

    // Queue
    expect(screen.getByText("high-priority")).toBeInTheDocument();

    // Runtime — formatDuration(2.5) => "2.50s"
    expect(screen.getByText("2.50s")).toBeInTheDocument();
  });

  it("shows state badge with correct CSS class", () => {
    const task = makeTask({ state: "FAILURE" });
    render(<TaskTable tasks={[task]} />);

    const badge = screen.getByText("FAILURE");
    expect(badge).toHaveClass("badge-failure");
  });

  it("renders different state badge classes for each state", () => {
    const states = ["SUCCESS", "PENDING", "STARTED", "RETRY"] as const;

    for (const state of states) {
      const { unmount } = render(
        <TaskTable tasks={[makeTask({ state, event_id: `evt-${state}` })]} />
      );

      const badge = screen.getByText(state);
      expect(badge).toHaveClass(`badge-${state.toLowerCase()}`);
      unmount();
    }
  });

  it("shows empty state when there are no tasks", () => {
    render(<TaskTable tasks={[]} />);

    expect(screen.getByText("No tasks found")).toBeInTheDocument();

    // Table should not be rendered
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("truncates long task IDs", () => {
    const task = makeTask({ task_id: "abcdef1234567890abcdef" });
    render(<TaskTable tasks={[task]} />);

    // truncateId defaults to 8 chars: "abcdef12..."
    expect(screen.getByText("abcdef12...")).toBeInTheDocument();
  });

  it("links task IDs to the task detail page", () => {
    const task = makeTask({ task_id: "abc123456789" });
    render(<TaskTable tasks={[task]} />);

    const link = screen.getByText("abc12345...");
    expect(link.closest("a")).toHaveAttribute("href", "/tasks/abc123456789");
  });

  it("shows dash for missing queue", () => {
    const task = makeTask({ queue: "" });
    render(<TaskTable tasks={[task]} />);

    // The em-dash should appear for queue column
    const cells = screen.getAllByText("—");
    expect(cells.length).toBeGreaterThanOrEqual(1);
  });

  it("shows dash for zero runtime", () => {
    const task = makeTask({ runtime: 0 });
    render(<TaskTable tasks={[task]} />);

    const cells = screen.getAllByText("—");
    expect(cells.length).toBeGreaterThanOrEqual(1);
  });

  it("shows Retry button for FAILURE state when onRetry is provided", async () => {
    const onRetry = vi.fn();
    const task = makeTask({ state: "FAILURE", task_id: "failed-task-123456" });

    render(<TaskTable tasks={[task]} onRetry={onRetry} />);

    const retryBtn = screen.getByText("Retry");
    expect(retryBtn).toBeInTheDocument();

    await userEvent.click(retryBtn);
    expect(onRetry).toHaveBeenCalledWith("failed-task-123456");
  });

  it("does not show Retry button for SUCCESS state", () => {
    const onRetry = vi.fn();
    const task = makeTask({ state: "SUCCESS" });

    render(<TaskTable tasks={[task]} onRetry={onRetry} />);

    expect(screen.queryByText("Retry")).not.toBeInTheDocument();
  });

  it("shows Revoke button for in-progress states when onRevoke is provided", async () => {
    const onRevoke = vi.fn();
    const task = makeTask({ state: "STARTED", task_id: "running-task-12345" });

    render(<TaskTable tasks={[task]} onRevoke={onRevoke} />);

    const revokeBtn = screen.getByText("Revoke");
    expect(revokeBtn).toBeInTheDocument();

    await userEvent.click(revokeBtn);
    expect(onRevoke).toHaveBeenCalledWith("running-task-12345");
  });

  it("does not show Revoke button for terminal states", () => {
    const onRevoke = vi.fn();
    const terminalStates = ["SUCCESS", "FAILURE", "REVOKED"] as const;

    for (const state of terminalStates) {
      const { unmount } = render(
        <TaskTable
          tasks={[makeTask({ state, event_id: `evt-${state}` })]}
          onRevoke={onRevoke}
        />
      );

      expect(screen.queryByText("Revoke")).not.toBeInTheDocument();
      unmount();
    }
  });

  it("renders multiple task rows", () => {
    const tasks = [
      makeTask({ event_id: "e1", task_name: "task_one" }),
      makeTask({ event_id: "e2", task_name: "task_two" }),
      makeTask({ event_id: "e3", task_name: "task_three" }),
    ];

    render(<TaskTable tasks={tasks} />);

    expect(screen.getByText("task_one")).toBeInTheDocument();
    expect(screen.getByText("task_two")).toBeInTheDocument();
    expect(screen.getByText("task_three")).toBeInTheDocument();
  });

  it("truncates long worker IDs to 20 characters", () => {
    const task = makeTask({
      worker_id: "worker-hostname-1234567890abcdef-extra-long",
    });
    render(<TaskTable tasks={[task]} />);

    // truncateId(workerId, 20) => first 20 chars + "..."
    expect(
      screen.getByText("worker-hostname-1234...")
    ).toBeInTheDocument();
  });

  it("shows dash when worker_id is empty", () => {
    const task = makeTask({ worker_id: "" });
    render(<TaskTable tasks={[task]} />);

    const cells = screen.getAllByText("—");
    expect(cells.length).toBeGreaterThanOrEqual(1);
  });
});
