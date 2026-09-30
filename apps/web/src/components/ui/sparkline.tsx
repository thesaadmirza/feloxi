/// A thin trace that stretches to its container. `color` is any CSS colour,
/// usually a token like "var(--fail)".
export function Sparkline({
  values,
  color = "var(--t2)",
  fill,
  height = 24,
  className,
  label,
}: {
  values: number[];
  color?: string;
  fill?: string;
  height?: number;
  className?: string;
  label?: string;
}) {
  if (values.length < 2) {
    return <div className={className} style={{ height }} aria-hidden={!label} aria-label={label} />;
  }
  const w = 100;
  const h = height;
  const max = Math.max(...values);
  const min = Math.min(...values);
  const range = max - min || 1;
  const pts = values.map((v, i) => {
    const x = (i / (values.length - 1)) * w;
    const y = h - 2 - ((v - min) / range) * (h - 4);
    return [x, y] as const;
  });
  const line = pts.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(" ");
  const area = `M0,${h} L${pts.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(" L")} L${w},${h} Z`;
  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio="none"
      className={className}
      style={{ width: "100%", height }}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      {fill && <path d={area} fill={fill} />}
      <polyline
        points={line}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
