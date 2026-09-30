"use client";

import { format } from "date-fns";
import { $api } from "@/lib/api";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { ErrorAlert } from "@/components/shared/error-alert";
import { Skeleton } from "@/components/shared/skeleton";
import { CopyButton } from "@/components/settings/copy-button";
import { InfoRow, SettingsHeader } from "@/components/settings/section";

type SettingsData = {
  id?: string;
  name?: string;
  slug?: string;
  created_at?: string;
};

export default function SettingsPage() {
  const { data, isLoading, isError, error } = $api.useQuery("get", "/api/v1/settings");

  const settings = data as SettingsData | null;

  return (
    <>
      <SettingsHeader
        title="General"
        description="The organization you're signed in to. Its name is what invited members see."
      />

      {isError && (
        <ErrorAlert>
          {(error as unknown as Error)?.message ?? "Couldn't load organization details."}
        </ErrorAlert>
      )}

      <Panel aria-label="Organization">
        <PanelHeader title="Organization" />
        {isLoading ? (
          <div className="flex flex-col gap-3 border-t border-line-soft px-4 py-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-5 w-full" />
            ))}
          </div>
        ) : (
          <dl>
            <InfoRow label="Name">
              <span className="truncate font-[550]">{settings?.name ?? "—"}</span>
            </InfoRow>
            <InfoRow label="Slug">
              <span className="truncate font-mono text-[12.5px]">{settings?.slug ?? "—"}</span>
            </InfoRow>
            <InfoRow label="Organization ID">
              <span className="min-w-0 flex-1 truncate font-mono text-[12.5px]">
                {settings?.id ?? "—"}
              </span>
              {settings?.id && <CopyButton text={settings.id} variant="ghost" />}
            </InfoRow>
            <InfoRow label="Created">
              {settings?.created_at ? (
                <time dateTime={settings.created_at} className="tabular-nums">
                  {format(new Date(settings.created_at), "d MMM yyyy")}
                </time>
              ) : (
                "—"
              )}
            </InfoRow>
          </dl>
        )}
      </Panel>
    </>
  );
}
