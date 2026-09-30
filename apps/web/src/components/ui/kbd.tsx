import { cn } from "@/lib/utils";

export function Kbd({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <kbd
      className={cn(
        "inline-flex h-[18px] min-w-[18px] items-center justify-center rounded border border-line-strong px-1 font-mono text-[10.5px] leading-none text-t3",
        className,
      )}
    >
      {children}
    </kbd>
  );
}
