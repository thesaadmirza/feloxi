"use client";

import { useMemo } from "react";
import { OctagonAlert, TriangleAlert, Info } from "lucide-react";
import { $api } from "@/lib/api";
import { formatDuration } from "@/lib/utils";
import { Chip } from "@/components/ui/chip";
import { PanelLink } from "@/components/ui/panel";

/// Incidents firing right now, most severe first, with their rule names.
/// Shares query keys with the sidebar and the alerts page.
export function useFiringAlerts(enabled = true) {
  const history = $api.useQuery(
    "get",
    "/api/v1/alerts/history",
    { params: { query: { limit: 50 } } },
    { refetchInterval: 30_000, enabled },
  );
  const rules = $api.useQuery("get", "/api/v1/alerts/rules", {}, { staleTime: 60_000, enabled });
  return useMemo(() => {
    const names = new Map((rules.data?.data ?? []).map((r) => [r.id, r.name]));
    const rank = (s: string) => (s === "critical" ? 0 : s === "warning" ? 1 : 2);
    return (history.data?.data ?? [])
      .filter((r) => !r.resolved_at)
      .map((r) => ({ ...r, name: names.get(r.rule_id) ?? "Alert" }))
      .sort(
        (a, b) =>
          rank(a.severity) - rank(b.severity) || Date.parse(a.fired_at) - Date.parse(b.fired_at),
      );
  }, [history.data, rules.data]);
}

/// "Is anything on fire?" answered before any chart. Renders nothing when
/// all is quiet.
export function AttentionStrip({ enabled = true }: { enabled?: boolean }) {
  const firing = useFiringAlerts(enabled);
  if (firing.length === 0) return null;

  return (
    <section
      aria-label="Needs attention"
      className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-border bg-card py-2.5 pr-4 pl-4"
    >
      <span className="flex items-center gap-2.5">
        <span
          className="size-2 shrink-0 rounded-full bg-fail shadow-[0_0_0_4px_var(--fail-wash)]"
          aria-hidden
        />
        <span className="font-semibold">
          {firing.length} alert{firing.length === 1 ? "" : "s"} firing
        </span>
      </span>
      {firing.slice(0, 2).map((a) => (
        <span key={a.id} className="flex min-w-0 items-center gap-2 text-[13px]">
          <span className="hidden text-t4 sm:inline" aria-hidden>
            |
          </span>
          <SeverityChip severity={a.severity} />
          <span className="font-[550] text-foreground">{a.name}</span>
          <span className="hidden truncate text-t3 md:inline" title={a.summary}>
            {a.summary}
          </span>
          <span className="shrink-0 text-t3 tabular-nums">
            · {formatDuration((Date.now() - Date.parse(a.fired_at)) / 1000)}
          </span>
        </span>
      ))}
      {firing.length > 2 && <span className="text-[13px] text-t3">+{firing.length - 2} more</span>}
      <span className="ml-auto">
        <PanelLink href="/alerts">Open alerts</PanelLink>
      </span>
    </section>
  );
}

export function SeverityChip({ severity }: { severity: string }) {
  if (severity === "critical")
    return (
      <Chip tone="fail" icon={<OctagonAlert />}>
        Critical
      </Chip>
    );
  if (severity === "warning")
    return (
      <Chip tone="warn" icon={<TriangleAlert />}>
        Warning
      </Chip>
    );
  return (
    <Chip tone="run" icon={<Info />}>
      Info
    </Chip>
  );
}
