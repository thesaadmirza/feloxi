export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      className={`animate-pulse bg-secondary rounded ${className ?? "h-4 w-full"}`}
    />
  );
}
