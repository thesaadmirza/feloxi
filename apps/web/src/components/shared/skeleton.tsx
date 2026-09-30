export function Skeleton({ className }: { className?: string }) {
  return <div className={`animate-pulse rounded-md bg-raised ${className ?? "h-4 w-full"}`} />;
}
