"use client";

import * as RadixDialog from "@radix-ui/react-dialog";
import { Loader2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "./button";

type ModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: React.ReactNode;
  description?: React.ReactNode;
  children?: React.ReactNode;
  footer?: React.ReactNode;
  /// Tailwind max-width class for the panel.
  size?: "sm" | "md" | "lg" | "xl";
  className?: string;
};

const SIZES = {
  sm: "max-w-[400px]",
  md: "max-w-[520px]",
  lg: "max-w-[680px]",
  xl: "max-w-[860px]",
};

/// Centered dialog on a warm scrim. The body scrolls; header and footer stay put.
export function Modal({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  size = "md",
  className,
}: ModalProps) {
  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="fixed inset-0 z-50 bg-[var(--scrim)]" />
        <RadixDialog.Content
          className={cn(
            "fixed top-1/2 left-1/2 z-50 flex max-h-[calc(100dvh-32px)] w-[calc(100vw-24px)] -translate-x-1/2 -translate-y-1/2 flex-col rounded-2xl border border-line-strong bg-card shadow-float outline-none",
            SIZES[size],
            className,
          )}
        >
          <div className="flex items-start gap-4 px-5 pt-5 pb-3">
            <div className="min-w-0 flex-1">
              <RadixDialog.Title className="text-[15px] font-semibold tracking-[-0.01em]">
                {title}
              </RadixDialog.Title>
              {description ? (
                <RadixDialog.Description className="mt-1 text-[13px] leading-relaxed text-t2">
                  {description}
                </RadixDialog.Description>
              ) : (
                <RadixDialog.Description className="sr-only">
                  {typeof title === "string" ? title : "Dialog"}
                </RadixDialog.Description>
              )}
            </div>
            <RadixDialog.Close asChild>
              <Button variant="ghost" size="icon-sm" aria-label="Close" className="-mt-1 -mr-2">
                <X />
              </Button>
            </RadixDialog.Close>
          </div>
          {children != null && (
            <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-4">{children}</div>
          )}
          {footer && (
            <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border px-5 py-3">
              {footer}
            </div>
          )}
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}

type ConfirmProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: React.ReactNode;
  description?: React.ReactNode;
  /// Mono line naming the thing being acted on.
  subject?: React.ReactNode;
  confirmLabel: string;
  tone?: "primary" | "danger";
  busy?: boolean;
  onConfirm: () => void;
  children?: React.ReactNode;
};

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  subject,
  confirmLabel,
  tone = "primary",
  busy,
  onConfirm,
  children,
}: ConfirmProps) {
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={description}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant={tone === "danger" ? "danger-solid" : "primary"}
            onClick={onConfirm}
            disabled={busy}
            autoFocus
          >
            {busy && <Loader2 className="animate-spin" />}
            {confirmLabel}
          </Button>
        </>
      }
    >
      {(subject || children) && (
        <div className="flex flex-col gap-3">
          {subject && (
            <div className="truncate rounded-lg border border-border bg-code px-3 py-2 font-mono text-[12px] text-t2">
              {subject}
            </div>
          )}
          {children}
        </div>
      )}
    </Modal>
  );
}
