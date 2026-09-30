import type { MessagePart } from "@/lib/fingerprint";

/// Renders a normalized exception message, drawing each placeholder
/// ({order_id}, {url}…) as a small token so variable parts read as such.
export function ExceptionMessage({
  parts,
  className,
}: {
  parts: MessagePart[];
  className?: string;
}) {
  if (parts.length === 0) return <span className={className}>No message</span>;
  return (
    <span className={className}>
      {parts.map((p, i) =>
        "param" in p ? (
          <span
            key={i}
            className="mx-px inline-block rounded border border-border bg-raised px-1 font-mono text-[11.5px] leading-[17px] text-t3"
          >
            {p.param}
          </span>
        ) : (
          <span key={i}>{p.text}</span>
        ),
      )}
    </span>
  );
}
