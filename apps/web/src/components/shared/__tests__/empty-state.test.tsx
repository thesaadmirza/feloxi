import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { EmptyState } from "../empty-state";

describe("EmptyState", () => {
  it("renders the title", () => {
    render(<EmptyState title="No tasks found" />);

    expect(screen.getByText("No tasks found")).toBeInTheDocument();
  });

  it("renders the description when provided", () => {
    render(
      <EmptyState
        title="No data"
        description="There is nothing to display right now."
      />
    );

    expect(screen.getByText("No data")).toBeInTheDocument();
    expect(
      screen.getByText("There is nothing to display right now.")
    ).toBeInTheDocument();
  });

  it("does not render description when not provided", () => {
    const { container } = render(<EmptyState title="Empty" />);

    // Only one <p> element (the title), no description paragraph
    const paragraphs = container.querySelectorAll("p");
    expect(paragraphs).toHaveLength(1);
    expect(paragraphs[0]).toHaveTextContent("Empty");
  });

  it("renders the action button when provided", () => {
    render(
      <EmptyState
        title="No items"
        action={<button>Create New</button>}
      />
    );

    expect(screen.getByText("Create New")).toBeInTheDocument();
  });

  it("does not render action area when not provided", () => {
    const { container } = render(<EmptyState title="Nothing here" />);

    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("renders a custom icon when provided", () => {
    render(
      <EmptyState
        title="No data"
        icon={<svg data-testid="custom-icon" />}
      />
    );

    expect(screen.getByTestId("custom-icon")).toBeInTheDocument();
  });

  it("does not render icon wrapper when icon is not provided", () => {
    const { container } = render(<EmptyState title="No icon" />);

    // The icon wrapper has class "mb-4", check it's not present
    const iconWrapper = container.querySelector(".mb-4");
    expect(iconWrapper).not.toBeInTheDocument();
  });

  it("applies custom className", () => {
    const { container } = render(
      <EmptyState title="Custom" className="my-custom-class" />
    );

    expect(container.firstChild).toHaveClass("my-custom-class");
  });

  it("renders all elements together: icon, title, description, and action", () => {
    render(
      <EmptyState
        icon={<svg data-testid="icon" />}
        title="Complete empty state"
        description="This has all the optional parts."
        action={<button>Do something</button>}
      />
    );

    expect(screen.getByTestId("icon")).toBeInTheDocument();
    expect(screen.getByText("Complete empty state")).toBeInTheDocument();
    expect(
      screen.getByText("This has all the optional parts.")
    ).toBeInTheDocument();
    expect(screen.getByText("Do something")).toBeInTheDocument();
  });

  it("renders title as a semibold paragraph", () => {
    render(<EmptyState title="Bold title" />);

    const title = screen.getByText("Bold title");
    expect(title.tagName).toBe("P");
    expect(title).toHaveClass("font-semibold");
  });
});
