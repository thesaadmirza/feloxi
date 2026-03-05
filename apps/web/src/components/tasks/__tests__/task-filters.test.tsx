import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TaskFilters } from "../task-filters";

// ---------------------------------------------------------------------------
// Capture the mocked router so we can inspect push() calls.
// The mock itself is in src/test/setup.ts; we just need the reference.
// ---------------------------------------------------------------------------

const mockPush = vi.fn();
let mockSearchParams = new URLSearchParams();

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: mockPush,
    back: vi.fn(),
    forward: vi.fn(),
    replace: vi.fn(),
    refresh: vi.fn(),
    prefetch: vi.fn(),
  }),
  useSearchParams: () => mockSearchParams,
  usePathname: () => "/tasks",
}));

beforeEach(() => {
  mockPush.mockClear();
  mockSearchParams = new URLSearchParams();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("TaskFilters", () => {
  it("renders all three filter dropdowns", () => {
    render(<TaskFilters />);

    // The select elements each have a default "All ..." option
    expect(screen.getByDisplayValue("All States")).toBeInTheDocument();
    expect(screen.getByDisplayValue("All Task Types")).toBeInTheDocument();
    expect(screen.getByDisplayValue("All Queues")).toBeInTheDocument();
  });

  it("renders state filter with all task state options", () => {
    render(<TaskFilters />);

    const expectedStates = [
      "PENDING",
      "RECEIVED",
      "STARTED",
      "SUCCESS",
      "FAILURE",
      "RETRY",
      "REVOKED",
    ];

    for (const state of expectedStates) {
      expect(screen.getByRole("option", { name: state })).toBeInTheDocument();
    }
  });

  it("renders task name options when taskNames prop is provided", () => {
    render(
      <TaskFilters taskNames={["send_email", "process_payment"]} />
    );

    expect(
      screen.getByRole("option", { name: "send_email" })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("option", { name: "process_payment" })
    ).toBeInTheDocument();
  });

  it("renders queue name options when queueNames prop is provided", () => {
    render(<TaskFilters queueNames={["default", "high-priority"]} />);

    expect(
      screen.getByRole("option", { name: "default" })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("option", { name: "high-priority" })
    ).toBeInTheDocument();
  });

  it("calls router.push with correct params when state filter changes", async () => {
    render(<TaskFilters />);

    const stateSelect = screen.getByDisplayValue("All States");
    await userEvent.selectOptions(stateSelect, "FAILURE");

    expect(mockPush).toHaveBeenCalledWith("/tasks?state=FAILURE");
  });

  it("calls router.push with correct params when task_name filter changes", async () => {
    render(
      <TaskFilters taskNames={["send_email", "process_payment"]} />
    );

    const taskNameSelect = screen.getByDisplayValue("All Task Types");
    await userEvent.selectOptions(taskNameSelect, "send_email");

    expect(mockPush).toHaveBeenCalledWith("/tasks?task_name=send_email");
  });

  it("calls router.push with correct params when queue filter changes", async () => {
    render(<TaskFilters queueNames={["default", "celery"]} />);

    const queueSelect = screen.getByDisplayValue("All Queues");
    await userEvent.selectOptions(queueSelect, "celery");

    expect(mockPush).toHaveBeenCalledWith("/tasks?queue=celery");
  });

  it("removes param when selecting the default (empty) option", async () => {
    // Start with a state already selected
    mockSearchParams = new URLSearchParams("state=FAILURE");

    render(<TaskFilters />);

    const stateSelect = screen.getByDisplayValue("FAILURE");
    await userEvent.selectOptions(stateSelect, "");

    // Should push without the state param
    expect(mockPush).toHaveBeenCalledWith("/tasks?");
  });

  it("does not show Clear Filters button when no filters are active", () => {
    render(<TaskFilters />);

    expect(screen.queryByText("Clear Filters")).not.toBeInTheDocument();
  });

  it("shows Clear Filters button when a state filter is active", () => {
    mockSearchParams = new URLSearchParams("state=FAILURE");

    render(<TaskFilters />);

    expect(screen.getByText("Clear Filters")).toBeInTheDocument();
  });

  it("shows Clear Filters button when a task_name filter is active", () => {
    mockSearchParams = new URLSearchParams("task_name=send_email");

    render(
      <TaskFilters taskNames={["send_email"]} />
    );

    expect(screen.getByText("Clear Filters")).toBeInTheDocument();
  });

  it("shows Clear Filters button when a queue filter is active", () => {
    mockSearchParams = new URLSearchParams("queue=default");

    render(<TaskFilters queueNames={["default"]} />);

    expect(screen.getByText("Clear Filters")).toBeInTheDocument();
  });

  it("navigates to /tasks (clearing params) when Clear Filters is clicked", async () => {
    mockSearchParams = new URLSearchParams("state=FAILURE");

    render(<TaskFilters />);

    await userEvent.click(screen.getByText("Clear Filters"));

    expect(mockPush).toHaveBeenCalledWith("/tasks");
  });

  it("preserves existing params when adding a new filter", async () => {
    mockSearchParams = new URLSearchParams("state=FAILURE");

    render(<TaskFilters queueNames={["default"]} />);

    const queueSelect = screen.getByDisplayValue("All Queues");
    await userEvent.selectOptions(queueSelect, "default");

    expect(mockPush).toHaveBeenCalledWith(
      "/tasks?state=FAILURE&queue=default"
    );
  });
});
