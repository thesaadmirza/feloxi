"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { Cable, Loader2, Play, PlugZap, Plus, Square, Trash2 } from "lucide-react";
import { $api, fetchClient, unwrap } from "@/lib/api";
import type { BrokerConfig } from "@/types/api";
import { PageBody, PageHeader } from "@/components/layout/page";
import { Button } from "@/components/ui/button";
import { ConfirmDialog, Modal } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/field";
import { Panel } from "@/components/ui/panel";
import { Table, Td, Th, THead, Tr } from "@/components/ui/table";
import { EmptyState } from "@/components/shared/empty-state";
import { ErrorAlert, Notice } from "@/components/shared/error-alert";
import { Skeleton } from "@/components/shared/skeleton";
import { BrokerStatusChip, BrokerTypeTag } from "@/components/infra/broker-status";
import { CodeBlock } from "@/components/infra/code-block";
import { errorText, maskUrlPasswords } from "@/components/infra/error-text";

function BrokerRow({ broker }: { broker: BrokerConfig }) {
  const queryClient = useQueryClient();
  const [confirmDelete, setConfirmDelete] = useState(false);

  const startMutation = useMutation({
    mutationFn: () =>
      unwrap(
        fetchClient.POST("/api/v1/brokers/{id}/start", { params: { path: { id: broker.id } } }),
      ),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["get", "/api/v1/brokers"] }),
  });

  const stopMutation = useMutation({
    mutationFn: () =>
      unwrap(
        fetchClient.POST("/api/v1/brokers/{id}/stop", { params: { path: { id: broker.id } } }),
      ),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["get", "/api/v1/brokers"] }),
  });

  const deleteMutation = useMutation({
    mutationFn: () =>
      unwrap(fetchClient.DELETE("/api/v1/brokers/{id}", { params: { path: { id: broker.id } } })),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["get", "/api/v1/brokers"] }),
  });

  const isToggling = startMutation.isPending || stopMutation.isPending;
  const isConnected = broker.status === "connected";
  const lastError = broker.last_error ? maskUrlPasswords(broker.last_error) : null;

  return (
    <Tr className="transition-colors hover:bg-hover">
      <Td className="min-w-0">
        <Link
          href={`/brokers/${broker.id}`}
          className="block truncate font-[550] text-foreground transition-colors hover:text-link"
          title={broker.name}
        >
          {broker.name}
        </Link>
        <div className="mt-1 sm:hidden">
          <BrokerTypeTag type={broker.broker_type} />
        </div>
        {lastError && (
          <p className="mt-1 truncate text-xs text-t3 md:hidden" title={lastError}>
            {lastError}
          </p>
        )}
      </Td>
      <Td className="hidden sm:table-cell">
        <BrokerTypeTag type={broker.broker_type} />
      </Td>
      <Td>
        <BrokerStatusChip broker={broker} />
      </Td>
      <Td className="hidden min-w-0 md:table-cell">
        {lastError ? (
          <span className="block truncate text-t3" title={lastError}>
            {lastError}
          </span>
        ) : (
          <span className="text-t4">—</span>
        )}
      </Td>
      <Td align="right" className="py-2">
        <div className="flex items-center justify-end gap-1.5">
          <Button
            size="sm"
            onClick={() => (isConnected ? stopMutation.mutate() : startMutation.mutate())}
            disabled={isToggling}
            title={isConnected ? "Stop" : "Start"}
          >
            {isToggling ? (
              <Loader2 className="animate-spin" aria-hidden />
            ) : isConnected ? (
              <Square aria-hidden />
            ) : (
              <Play aria-hidden />
            )}
            <span className="max-sm:sr-only">{isConnected ? "Stop" : "Start"}</span>
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => setConfirmDelete(true)}
            aria-label={`Delete ${broker.name}`}
            title="Delete"
            className="hover:text-fail"
          >
            <Trash2 />
          </Button>
        </div>
        <ConfirmDialog
          open={confirmDelete}
          onOpenChange={(open) => {
            if (!open && !deleteMutation.isPending) {
              setConfirmDelete(false);
              deleteMutation.reset();
            }
          }}
          title="Delete this broker?"
          description="Feloxi stops consuming its events and removes the connection. Events already stored are kept."
          subject={broker.name}
          confirmLabel="Delete broker"
          tone="danger"
          busy={deleteMutation.isPending}
          onConfirm={() =>
            deleteMutation.mutate(undefined, { onSuccess: () => setConfirmDelete(false) })
          }
        >
          {deleteMutation.isError && (
            <p className="text-xs text-fail">
              {errorText(deleteMutation.error) ?? "Couldn't delete the broker."}
            </p>
          )}
        </ConfirmDialog>
      </Td>
    </Tr>
  );
}

type BrokerType = "redis" | "rabbitmq";

const BROKER_DEFAULTS: Record<BrokerType, string> = {
  redis: "redis://localhost:6379/0",
  rabbitmq: "amqp://guest:guest@localhost:5672//",
};

const BROKER_LABELS: Record<BrokerType, string> = { redis: "Redis", rabbitmq: "RabbitMQ" };

function AddBrokerModal({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const [brokerType, setBrokerType] = useState<BrokerType>("redis");
  const [connectionUrl, setConnectionUrl] = useState(BROKER_DEFAULTS.redis);
  const [brokerName, setBrokerName] = useState("Production");
  const [testResult, setTestResult] = useState<{
    success: boolean;
    error?: string;
  } | null>(null);

  const testMutation = useMutation({
    mutationFn: () =>
      unwrap(
        fetchClient.POST("/api/v1/brokers/test", {
          body: {
            broker_type: brokerType,
            connection_url: connectionUrl,
          },
        }),
      ),
    onSuccess: (data) => setTestResult({ success: data.success, error: data.error ?? undefined }),
  });

  const createMutation = useMutation({
    mutationFn: () =>
      unwrap(
        fetchClient.POST("/api/v1/brokers", {
          body: {
            name: brokerName || `${brokerType === "redis" ? "Redis" : "RabbitMQ"} Broker`,
            broker_type: brokerType,
            connection_url: connectionUrl,
          },
        }),
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["get", "/api/v1/brokers"] });
      onClose();
    },
  });

  function handleBrokerTypeChange(type: BrokerType) {
    setBrokerType(type);
    setConnectionUrl(BROKER_DEFAULTS[type]);
    setTestResult(null);
    testMutation.reset();
  }

  const label = BROKER_LABELS[brokerType];

  return (
    <Modal
      open
      onOpenChange={(open) => !open && onClose()}
      title="Add broker"
      description="Feloxi connects to the broker your Celery workers use and reads the task events they publish."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="submit"
            form="add-broker-form"
            variant="primary"
            disabled={createMutation.isPending || !connectionUrl}
          >
            {createMutation.isPending && <Loader2 className="animate-spin" aria-hidden />}
            Add broker
          </Button>
        </>
      }
    >
      <form
        id="add-broker-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (connectionUrl && !createMutation.isPending) createMutation.mutate();
        }}
        className="flex flex-col gap-4"
      >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-[150px_minmax(0,1fr)]">
          <Field label="Type" htmlFor="broker-type">
            <Select
              id="broker-type"
              value={brokerType}
              onChange={(e) => handleBrokerTypeChange(e.target.value as BrokerType)}
            >
              <option value="redis">Redis</option>
              <option value="rabbitmq">RabbitMQ</option>
            </Select>
          </Field>
          <Field label="Name" htmlFor="broker-name">
            <Input
              id="broker-name"
              value={brokerName}
              onChange={(e) => setBrokerName(e.target.value)}
              placeholder="e.g. Production Redis"
              autoComplete="off"
            />
          </Field>
        </div>

        <Field
          label={brokerType === "redis" ? "Redis URL" : "AMQP URL"}
          htmlFor="broker-url"
          hint={`The same ${label} URL your Celery workers connect to.`}
        >
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              id="broker-url"
              value={connectionUrl}
              onChange={(e) => {
                setConnectionUrl(e.target.value);
                setTestResult(null);
                testMutation.reset();
              }}
              placeholder={BROKER_DEFAULTS[brokerType]}
              autoComplete="off"
              spellCheck={false}
              className="font-mono text-[12.5px]"
            />
            <Button
              onClick={() => testMutation.mutate()}
              disabled={testMutation.isPending || !connectionUrl}
              className="h-9 shrink-0"
            >
              {testMutation.isPending ? (
                <Loader2 className="animate-spin" aria-hidden />
              ) : (
                <PlugZap aria-hidden />
              )}
              Test connection
            </Button>
          </div>
        </Field>

        {testResult &&
          (testResult.success ? (
            <Notice>Connection successful</Notice>
          ) : (
            <ErrorAlert>
              <span className="font-semibold">Connection failed</span>
              {testResult.error && (
                <span className="mt-0.5 block break-words opacity-90">{testResult.error}</span>
              )}
            </ErrorAlert>
          ))}
        {testMutation.isError && !testResult && (
          <ErrorAlert>
            <span className="font-semibold">Couldn&apos;t run the test</span>
            <span className="mt-0.5 block break-words opacity-90">
              {errorText(testMutation.error) ?? "The request failed."}
            </span>
          </ErrorAlert>
        )}

        <section
          aria-labelledby="worker-events"
          className="flex flex-col gap-2 border-t border-border pt-4"
        >
          <h3 id="worker-events" className="text-[13px] font-semibold text-foreground">
            Turn on worker events
          </h3>
          <p className="text-[13px] leading-relaxed text-t2">
            Celery workers need the{" "}
            <code className="font-mono text-[12px] text-foreground">--events</code> flag to publish
            task events to the broker. Start your worker with events enabled:
          </p>
          <CodeBlock code="celery -A myapp worker --loglevel=info --events" />
          <p className="pt-1 text-[13px] leading-relaxed text-t2">
            Already running? Enable events at runtime:
          </p>
          <CodeBlock code="celery -A myapp control enable_events" />
        </section>

        {createMutation.isError && (
          <ErrorAlert>
            {errorText(createMutation.error) ?? "Failed to create broker connection"}
          </ErrorAlert>
        )}
      </form>
    </Modal>
  );
}

export default function BrokersPage() {
  const [showModal, setShowModal] = useState(false);

  function openModal() {
    setShowModal(true);
  }

  const { data, isLoading, isError, error } = $api.useQuery("get", "/api/v1/brokers", undefined, {
    refetchInterval: 10_000,
  });

  const brokers = data?.data ?? [];
  const connected = brokers.filter((b) => b.status === "connected").length;
  const withErrors = brokers.filter((b) => b.status === "error").length;

  return (
    <>
      <PageHeader
        title="Brokers"
        meta={
          brokers.length > 0
            ? `${brokers.length} broker${brokers.length === 1 ? "" : "s"} · ${connected} connected`
            : undefined
        }
        actions={
          <Button variant="primary" onClick={openModal}>
            <Plus aria-hidden />
            Add broker
          </Button>
        }
      />
      <PageBody>
        {isError && (
          <ErrorAlert>
            Couldn&apos;t load brokers. {errorText(error) ?? "The API may be unreachable."}
          </ErrorAlert>
        )}

        {withErrors > 0 && (
          <ErrorAlert>
            {withErrors === 1
              ? "1 broker is reporting an error."
              : `${withErrors} brokers are reporting errors.`}
          </ErrorAlert>
        )}

        {isLoading ? (
          <Panel className="flex flex-col gap-2 p-4" aria-label="Loading brokers">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-9 w-full" />
            ))}
          </Panel>
        ) : brokers.length === 0 ? (
          !isError && (
            <Panel>
              <EmptyState
                icon={<Cable />}
                title="No brokers configured"
                description="Connect your first message broker to start monitoring Celery tasks."
                action={
                  <Button onClick={openModal}>
                    <Plus aria-hidden />
                    Add broker
                  </Button>
                }
              />
            </Panel>
          )
        ) : (
          <Panel className="overflow-hidden" aria-label="Brokers">
            <div className="overflow-x-auto">
              <Table className="table-fixed">
                <THead>
                  <Th className="md:w-[30%]">Name</Th>
                  <Th className="hidden w-[112px] sm:table-cell">Type</Th>
                  <Th className="w-[128px] sm:w-[144px]">Status</Th>
                  <Th className="hidden md:table-cell">Error</Th>
                  <Th className="w-[100px] sm:w-[148px]">
                    <span className="sr-only">Actions</span>
                  </Th>
                </THead>
                <tbody>
                  {brokers.map((broker) => (
                    <BrokerRow key={broker.id} broker={broker} />
                  ))}
                </tbody>
              </Table>
            </div>
          </Panel>
        )}
      </PageBody>

      {showModal && <AddBrokerModal onClose={() => setShowModal(false)} />}
    </>
  );
}
