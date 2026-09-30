"use client";

import { useMemo, useRef, useState } from "react";
import { BellOff, Plus } from "lucide-react";
import { $api } from "@/lib/api";
import { useHasPermission } from "@/hooks/use-current-user";
import { PageBody, PageHeader } from "@/components/layout/page";
import { Button } from "@/components/ui/button";
import { Tab, Tabs } from "@/components/ui/tabs";
import { ErrorAlert } from "@/components/shared/error-alert";
import { Incidents } from "@/components/alerts/incidents";
import { AlertRuleModal } from "@/components/alerts/rule-modal";
import { RulesList } from "@/components/alerts/rules-list";
import { Silences } from "@/components/alerts/silences";
import type { AlertHistory, AlertRule, AlertSilence } from "@/types/api";

const HISTORY_LIMIT = 50;

type TabId = "incidents" | "rules" | "silences";

export default function AlertsPage() {
  const canWrite = useHasPermission("alerts_write");
  const [activeTab, setActiveTab] = useState<TabId>("incidents");
  const [historyOffset, setHistoryOffset] = useState(0);
  const [modal, setModal] = useState<{ open: boolean; editRule?: AlertRule | null }>({
    open: false,
  });
  const silenceForm = useRef<HTMLDivElement>(null);

  const rulesQuery = $api.useQuery("get", "/api/v1/alerts/rules");
  const historyQuery = $api.useQuery(
    "get",
    "/api/v1/alerts/history",
    { params: { query: { limit: HISTORY_LIMIT, offset: historyOffset } } },
    { refetchInterval: 30_000 },
  );
  const silencesQuery = $api.useQuery("get", "/api/v1/alerts/silences");

  const rules = useMemo(() => (rulesQuery.data?.data ?? []) as AlertRule[], [rulesQuery.data]);
  const history = useMemo(
    () => (historyQuery.data?.data ?? []) as AlertHistory[],
    [historyQuery.data],
  );
  const silences = useMemo(
    () => (silencesQuery.data?.data ?? []) as AlertSilence[],
    [silencesQuery.data],
  );

  const firing = history.filter((h) => !h.resolved_at);
  const firingRuleIds = useMemo(() => new Set(firing.map((h) => h.rule_id)), [firing]);
  const startOfDay = new Date().setHours(0, 0, 0, 0);
  const resolvedToday = history.filter(
    (h) => h.resolved_at && Date.parse(h.resolved_at) >= startOfDay,
  ).length;
  const activeSilences = silences.filter((s) => Date.parse(s.ends_at) > Date.now()).length;

  const meta = historyQuery.data
    ? [
        firing.length > 0 ? `${firing.length} firing` : "nothing firing",
        `${resolvedToday} resolved today`,
        activeSilences > 0 && `${activeSilences} silence${activeSilences === 1 ? "" : "s"} active`,
      ]
        .filter(Boolean)
        .join(" · ")
    : undefined;

  const openSilences = () => {
    setActiveTab("silences");
    requestAnimationFrame(() => {
      silenceForm.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      silenceForm.current?.querySelector("select")?.focus();
    });
  };

  return (
    <>
      <PageHeader
        title="Alerts"
        meta={meta}
        actions={
          canWrite ? (
            <>
              <Button onClick={openSilences}>
                <BellOff />
                Silence…
              </Button>
              <Button variant="primary" onClick={() => setModal({ open: true, editRule: null })}>
                <Plus />
                New rule
              </Button>
            </>
          ) : undefined
        }
      />
      <PageBody>
        <Tabs label="Alert views">
          <Tab
            active={activeTab === "incidents"}
            onClick={() => setActiveTab("incidents")}
            count={
              firing.length > 0 ? (
                <span className="rounded bg-fail-wash px-1.5 py-px text-[11px] font-semibold text-fail">
                  {firing.length} firing
                </span>
              ) : undefined
            }
          >
            Incidents
          </Tab>
          <Tab
            active={activeTab === "rules"}
            onClick={() => setActiveTab("rules")}
            count={rules.length || undefined}
          >
            Rules
          </Tab>
          <Tab
            active={activeTab === "silences"}
            onClick={() => setActiveTab("silences")}
            count={activeSilences || undefined}
          >
            Silences
          </Tab>
        </Tabs>

        {activeTab === "incidents" && (
          <>
            {historyQuery.isError && <ErrorAlert>Couldn&apos;t load incidents.</ErrorAlert>}
            <Incidents
              history={history}
              rules={rules}
              loading={historyQuery.isLoading}
              hasMore={historyQuery.data?.has_more ?? false}
              total={historyQuery.data?.total ?? undefined}
              page={Math.floor(historyOffset / HISTORY_LIMIT) + 1}
              limit={HISTORY_LIMIT}
              onNext={() => setHistoryOffset((prev) => prev + HISTORY_LIMIT)}
              onPrev={() => setHistoryOffset((prev) => Math.max(0, prev - HISTORY_LIMIT))}
              canWrite={canWrite}
              onEdit={(rule) => setModal({ open: true, editRule: rule })}
            />
          </>
        )}

        {activeTab === "rules" && (
          <>
            {rulesQuery.isError && <ErrorAlert>Couldn&apos;t load alert rules.</ErrorAlert>}
            <RulesList
              rules={rules}
              loading={rulesQuery.isLoading}
              canWrite={canWrite}
              firingRuleIds={firingRuleIds}
              onEdit={(rule) => setModal({ open: true, editRule: rule })}
              onCreate={() => setModal({ open: true, editRule: null })}
            />
          </>
        )}

        {activeTab === "silences" && (
          <Silences
            ref={silenceForm}
            rules={rules}
            canWrite={canWrite}
            silences={silences}
            loading={silencesQuery.isLoading}
            error={silencesQuery.isError}
          />
        )}
      </PageBody>

      {modal.open && (
        <AlertRuleModal editRule={modal.editRule} onClose={() => setModal({ open: false })} />
      )}
    </>
  );
}
