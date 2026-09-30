"use client";

import { Fragment, useMemo, useState } from "react";
import { ChevronRight } from "lucide-react";
import { splitException } from "@/lib/fingerprint";
import { cn } from "@/lib/utils";

type Frame = {
  kind: "frame";
  path: string;
  line: string;
  func: string;
  code: string[];
  library: boolean;
};
type Text = { kind: "text"; text: string; exception: boolean };
type Item = Frame | Text;
type Block = Text | { kind: "frames"; frames: Frame[]; library: boolean };

const FRAME = /^\s*File "(.+)", line (\d+), in (.+)$/;
const CARETS = /^\s*[\^~]+\s*$/;
const LIBRARY = /(site-packages|dist-packages)[\\/]|[\\/]lib[\\/]python\d|^<frozen|^</;

function parse(raw: string): Item[] {
  const items: Item[] = [];
  let frame: Frame | null = null;
  for (const line of raw.replace(/\r/g, "").split("\n")) {
    const m = FRAME.exec(line);
    if (m) {
      frame = {
        kind: "frame",
        path: m[1],
        line: m[2],
        func: m[3],
        code: [],
        library: LIBRARY.test(m[1]),
      };
      items.push(frame);
    } else if (frame && /^\s{4,}\S/.test(line)) {
      if (!CARETS.test(line)) frame.code.push(line.trim());
    } else if (line.trim()) {
      frame = null;
      const trimmed = line.trim();
      if (/^Traceback \(most recent call last\):$/.test(trimmed)) continue;
      const chain =
        /^(During handling of the above exception|The above exception was the direct cause)/.test(
          trimmed,
        );
      items.push({ kind: "text", text: trimmed, exception: !chain });
    }
  }
  return items;
}

function shortPath(path: string, library: boolean): string {
  const lib = /(?:site-packages|dist-packages)[\\/](.+)$/.exec(path);
  if (library && lib) return lib[1];
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts.length > 3 ? parts.slice(-3).join("/") : path;
}

/// Python traceback with library frames folded away and the line that
/// raised in your code highlighted.
export function Traceback({ raw, className }: { raw: string; className?: string }) {
  const items = useMemo(() => parse(raw), [raw]);
  const [open, setOpen] = useState<Set<number>>(new Set());
  const frames = items.filter((i): i is Frame => i.kind === "frame");

  if (frames.length === 0) {
    return (
      <pre
        className={cn(
          "overflow-auto rounded-lg border border-border bg-code p-3.5 font-mono text-[12px] leading-relaxed whitespace-pre-wrap break-words text-t2",
          className,
        )}
      >
        {raw}
      </pre>
    );
  }

  // The last frame in your own code is almost always where to look.
  const hot = [...frames].reverse().find((f) => !f.library) ?? frames[frames.length - 1];

  const blocks: Block[] = [];
  for (const it of items) {
    const last = blocks[blocks.length - 1];
    if (it.kind === "frame" && last?.kind === "frames" && last.library === it.library && it.library)
      last.frames.push(it);
    else if (it.kind === "frame")
      blocks.push({ kind: "frames", frames: [it], library: it.library });
    else blocks.push(it);
  }

  return (
    <div
      className={cn(
        "overflow-hidden rounded-lg border border-border bg-code font-mono text-[12px] leading-[1.7]",
        className,
      )}
    >
      {blocks.map((b, i) => {
        if (b.kind === "text") {
          if (!b.exception)
            return (
              <div key={i} className="px-3.5 pt-2.5 text-t3">
                {b.text}
              </div>
            );
          const { type, message } = splitException(b.text);
          return (
            <div key={i} className="px-3.5 py-2.5 break-words text-foreground">
              {type ? (
                <>
                  <span className="text-fail">{type}</span>
                  {message && <span>: {message}</span>}
                </>
              ) : (
                b.text
              )}
            </div>
          );
        }
        if (b.library && !open.has(i)) {
          const files = new Set(b.frames.map((f) => shortPath(f.path, true)));
          return (
            <button
              key={i}
              type="button"
              onClick={() => setOpen((s) => new Set(s).add(i))}
              className="flex w-full items-center gap-2 border-b border-border px-3.5 py-2 text-left text-t3 transition-colors hover:bg-hover hover:text-t2"
            >
              <ChevronRight className="size-3.5 shrink-0" aria-hidden />
              <span className="truncate">
                {b.frames.length} frame{b.frames.length === 1 ? "" : "s"} in{" "}
                {files.size === 1 ? [...files][0] : "libraries"}
              </span>
              <span className="label ml-auto shrink-0">library</span>
            </button>
          );
        }
        return (
          <Fragment key={i}>
            {b.frames.map((f, j) => (
              <div key={j} className={cn("pt-2", f.library && "opacity-70")}>
                <div className="truncate px-3.5" title={f.path}>
                  <span className="text-t3">File </span>
                  <span className="text-t1">&quot;{shortPath(f.path, f.library)}&quot;</span>
                  <span className="text-t3">, line </span>
                  <span className="text-link">{f.line}</span>
                  <span className="text-t3">, in </span>
                  <span className="text-t1">{f.func}</span>
                </div>
                {f.code.map((c, k) => (
                  <div
                    key={k}
                    className={cn(
                      "mx-2 rounded-md px-[1.625rem] py-0.5 break-words whitespace-pre-wrap",
                      f === hot ? "bg-fail-wash text-foreground" : "text-t2",
                    )}
                  >
                    {c}
                  </div>
                ))}
              </div>
            ))}
          </Fragment>
        );
      })}
    </div>
  );
}
