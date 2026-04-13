type Size = "xs" | "sm" | "md";

const SIZE_CLASSES: Record<Size, string> = {
  xs: "px-1.5 py-0.5 rounded text-[10px] font-medium",
  sm: "px-2 py-0.5 rounded text-xs font-medium",
  md: "px-3 py-1 rounded-full text-sm font-semibold",
};

export function StateBadge({
  state,
  size = "sm",
}: {
  state: string;
  size?: Size;
}) {
  return (
    <span
      className={`badge-${state.toLowerCase()} inline-flex items-center ${SIZE_CLASSES[size]}`}
    >
      {state}
    </span>
  );
}
