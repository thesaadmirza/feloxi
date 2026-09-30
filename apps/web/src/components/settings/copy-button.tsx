"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";
import { Button, type ButtonProps } from "@/components/ui/button";

/// Copies `text` and says "Copied" for a moment. If the clipboard is blocked
/// nothing changes, and the value stays on screen for a manual copy.
export function CopyButton({
  text,
  label = "Copy",
  resetAfter = 2000,
  variant = "secondary",
  size = "sm",
  className,
}: {
  text: string;
  label?: string;
  resetAfter?: number;
  variant?: ButtonProps["variant"];
  size?: ButtonProps["size"];
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      return;
    }
    setCopied(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), resetAfter);
  }

  return (
    <Button variant={variant} size={size} onClick={copy} className={className}>
      {copied ? <Check className="text-ok" /> : <Copy />}
      {copied ? "Copied" : label}
    </Button>
  );
}
