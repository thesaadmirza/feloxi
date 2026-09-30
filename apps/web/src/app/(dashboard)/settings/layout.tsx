"use client";

import { usePathname } from "next/navigation";
import { PageBody, PageHeader } from "@/components/layout/page";
import { SettingsNav, settingsSectionFor } from "@/components/settings/settings-nav";

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const section = settingsSectionFor(pathname);
  const onIndex = pathname === "/settings" || !section;

  return (
    <>
      {onIndex ? (
        <PageHeader title="Settings" />
      ) : (
        <PageHeader crumbs={[{ label: "Settings", href: "/settings" }, { label: section.label }]} />
      )}
      <PageBody>
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-[200px_minmax(0,1fr)] lg:gap-7">
          <SettingsNav pathname={pathname} />
          <div className="flex max-w-[760px] min-w-0 flex-col gap-5">{children}</div>
        </div>
      </PageBody>
    </>
  );
}
