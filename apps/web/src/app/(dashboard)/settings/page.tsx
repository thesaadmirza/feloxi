"use client";

import { useRouter } from "next/navigation";
import {
  Users,
  Key,
  Database,
  Bell,
  ChevronRight,
  Building2,
} from "lucide-react";
import { $api } from "@/lib/api";
import { Skeleton } from "@/components/shared/skeleton";

type SettingsData = {
  id?: string;
  name?: string;
  slug?: string;
  plan?: string;
  created_at?: string;
  max_agents?: number;
  max_events_day?: number;
};

const SUB_PAGES = [
  {
    href: "/settings/team",
    icon: Users,
    label: "Team",
    description: "Manage team members, roles, and invitations",
  },
  {
    href: "/settings/api-keys",
    icon: Key,
    label: "API Keys",
    description: "Create and revoke API keys for programmatic access",
  },
  {
    href: "/settings/retention",
    icon: Database,
    label: "Retention",
    description: "Configure how long task and worker events are stored",
  },
  {
    href: "/settings/notifications",
    icon: Bell,
    label: "Notifications",
    description: "Configure SMTP and webhook defaults for alert delivery",
  },
];

export default function SettingsPage() {
  const router = useRouter();

  const { data, isLoading } = $api.useQuery("get", "/api/v1/settings");

  const settings = data as SettingsData | null;

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Settings</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Manage your tenant configuration and preferences
        </p>
      </div>

      <div className="rounded-xl border border-border bg-card p-6">
        <div className="flex items-center gap-2 mb-4">
          <Building2 className="h-4 w-4 text-primary" />
          <h2 className="font-semibold text-foreground">Tenant Information</h2>
        </div>

        {isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-6 w-full" />
            ))}
          </div>
        ) : (
          <div className="space-y-0 divide-y divide-border">
            <InfoRow label="Tenant Name" value={settings?.name ?? "—"} />
            <InfoRow label="Tenant Slug" value={settings?.slug ?? "—"} />
            <InfoRow label="Plan" value={settings?.plan ?? "Free"} />
            <InfoRow
              label="Created"
              value={
                settings?.created_at
                  ? new Date(settings.created_at).toLocaleDateString()
                  : "—"
              }
            />
            {settings?.max_agents != null && (
              <InfoRow
                label="Max Brokers"
                value={String(settings.max_agents)}
              />
            )}
            {settings?.max_events_day != null && (
              <InfoRow
                label="Max Events/Day"
                value={settings.max_events_day.toLocaleString()}
              />
            )}
          </div>
        )}
      </div>

      <div className="space-y-2">
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
          Configuration
        </h2>
        <div className="rounded-xl border border-border bg-card divide-y divide-border overflow-hidden">
          {SUB_PAGES.map(({ href, icon: Icon, label, description }) => (
            <button
              key={href}
              onClick={() => router.push(href)}
              className="w-full flex items-center gap-4 px-5 py-4 hover:bg-secondary/40 transition text-left group"
            >
              <div className="h-10 w-10 rounded-lg bg-secondary flex items-center justify-center shrink-0">
                <Icon className="h-5 w-5 text-muted-foreground group-hover:text-primary transition" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-medium text-foreground">{label}</p>
                <p className="text-sm text-muted-foreground">{description}</p>
              </div>
              <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center gap-4 py-3">
      <span className="text-sm text-muted-foreground w-36 shrink-0">{label}</span>
      <span className="text-sm text-foreground">{value}</span>
    </div>
  );
}
