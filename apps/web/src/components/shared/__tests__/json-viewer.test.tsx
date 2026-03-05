import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { JsonViewer } from "../json-viewer";

// ---------------------------------------------------------------------------
// Mock: react-syntax-highlighter — avoid ESM import issues in jsdom
// ---------------------------------------------------------------------------
vi.mock("react-syntax-highlighter", () => ({
  __esModule: true,
  default: ({ children, language }: { children: string; language: string }) => (
    <pre data-testid="syntax-highlighter" data-language={language}>
      {children}
    </pre>
  ),
}));

vi.mock("react-syntax-highlighter/dist/esm/styles/hljs", () => ({
  atomOneDark: {},
}));

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("JsonViewer", () => {
  it("renders JSON object data", () => {
    const data = { name: "test", count: 42 };
    render(<JsonViewer value={data} />);

    const highlighter = screen.getByTestId("syntax-highlighter");
    expect(highlighter).toBeInTheDocument();
    expect(highlighter).toHaveTextContent('"name"');
    expect(highlighter).toHaveTextContent('"test"');
    expect(highlighter).toHaveTextContent("42");
  });

  it("renders a JSON string that gets parsed", () => {
    const jsonString = '{"key": "value"}';
    render(<JsonViewer value={jsonString} />);

    const highlighter = screen.getByTestId("syntax-highlighter");
    expect(highlighter).toHaveTextContent('"key"');
    expect(highlighter).toHaveTextContent('"value"');
  });

  it("renders nested objects", () => {
    const data = {
      user: {
        name: "Alice",
        address: {
          city: "Wonderland",
        },
      },
    };

    render(<JsonViewer value={data} />);

    const highlighter = screen.getByTestId("syntax-highlighter");
    expect(highlighter).toHaveTextContent('"Alice"');
    expect(highlighter).toHaveTextContent('"Wonderland"');
  });

  it("handles null value — shows empty indicator", () => {
    render(<JsonViewer value={null} />);

    expect(screen.getByText("empty")).toBeInTheDocument();
  });

  it("handles undefined value — shows empty indicator", () => {
    render(<JsonViewer value={undefined} />);

    expect(screen.getByText("empty")).toBeInTheDocument();
  });

  it("handles empty string value — shows empty indicator", () => {
    render(<JsonViewer value="" />);

    expect(screen.getByText("empty")).toBeInTheDocument();
  });

  it("handles whitespace-only string — shows empty indicator", () => {
    render(<JsonViewer value="   " />);

    expect(screen.getByText("empty")).toBeInTheDocument();
  });

  it("renders plain text for non-JSON strings", () => {
    render(<JsonViewer value="just a plain string" />);

    const highlighter = screen.getByTestId("syntax-highlighter");
    expect(highlighter).toHaveAttribute("data-language", "text");
    expect(highlighter).toHaveTextContent("just a plain string");
  });

  it("renders with json language for objects", () => {
    render(<JsonViewer value={{ key: "val" }} />);

    const highlighter = screen.getByTestId("syntax-highlighter");
    expect(highlighter).toHaveAttribute("data-language", "json");
  });

  it("displays a label when provided", () => {
    render(<JsonViewer value={{ a: 1 }} label="Result" />);

    expect(screen.getByText("Result")).toBeInTheDocument();
  });

  it("shows label in empty state when provided", () => {
    render(<JsonViewer value={null} label="Args" />);

    expect(screen.getByText("Args: empty")).toBeInTheDocument();
  });

  it("can toggle collapsed state", async () => {
    render(<JsonViewer value={{ key: "value" }} defaultCollapsed={true} />);

    // Initially collapsed — syntax highlighter should not be visible
    expect(screen.queryByTestId("syntax-highlighter")).not.toBeInTheDocument();

    // Click to expand
    const toggleBtn = screen.getByRole("button", { expanded: false });
    await userEvent.click(toggleBtn);

    // Now the highlighter should be visible
    expect(screen.getByTestId("syntax-highlighter")).toBeInTheDocument();
  });

  it("starts expanded by default for small payloads", () => {
    render(<JsonViewer value={{ small: true }} />);

    expect(screen.getByTestId("syntax-highlighter")).toBeInTheDocument();
  });

  it("shows Copy button when expanded", () => {
    render(<JsonViewer value={{ data: true }} />);

    expect(screen.getByLabelText("Copy to clipboard")).toBeInTheDocument();
  });

  it("hides Copy button when collapsed", () => {
    render(<JsonViewer value={{ data: true }} defaultCollapsed={true} />);

    expect(
      screen.queryByLabelText("Copy to clipboard")
    ).not.toBeInTheDocument();
  });

  it("renders arrays correctly", () => {
    const data = [1, 2, 3, "four"];
    render(<JsonViewer value={data} />);

    const highlighter = screen.getByTestId("syntax-highlighter");
    expect(highlighter).toHaveTextContent("1");
    expect(highlighter).toHaveTextContent('"four"');
  });

  it("renders boolean and number values", () => {
    const data = { active: true, count: 0, rate: 3.14 };
    render(<JsonViewer value={data} />);

    const highlighter = screen.getByTestId("syntax-highlighter");
    expect(highlighter).toHaveTextContent("true");
    expect(highlighter).toHaveTextContent("0");
    expect(highlighter).toHaveTextContent("3.14");
  });

  it("applies custom className", () => {
    const { container } = render(
      <JsonViewer value={{ test: true }} className="my-class" />
    );

    expect(container.firstChild).toHaveClass("my-class");
  });
});
