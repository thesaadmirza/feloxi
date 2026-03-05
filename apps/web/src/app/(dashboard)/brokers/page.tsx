"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import {
  Plug,
  Database,
  Trash2,
  Play,
  Square,
  Loader2,
  Cable,
  AlertCircle,
  Check,
  ArrowRight,
  Terminal,
  Copy,
  CheckCircle,
  X,
} from "lucide-react";
import { $api, fetchClient, unwrap } from "@/lib/api";
import type { BrokerConfig } from "@/types/api";

function StatusDot({ status }: { status: string }) {
  const color =
    status === "connected"
      ? "bg-emerald-400"
      : status === "error"
        ? "bg-red-400"
        : "bg-zinc-600";

  return (
    <span className="relative flex h-2.5 w-2.5">
      {status === "connected" && (
        <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-30 animate-ping" />
      )}
      <span className={`relative inline-flex rounded-full h-2.5 w-2.5 ${color}`} />
    </span>
  );
}

function BrokerTypeBadge({ type }: { type: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-medium bg-zinc-800 text-zinc-300">
      {type === "redis" ? (
        <Database className="w-3 h-3" />
      ) : (
        <Plug className="w-3 h-3" />
      )}
      {type === "redis" ? "Redis" : "RabbitMQ"}
    </span>
  );
}

function BrokerRow({ broker }: { broker: BrokerConfig }) {
  const queryClient = useQueryClient();
  const [confirmDelete, setConfirmDelete] = useState(false);

  const startMutation = useMutation({
    mutationFn: () => unwrap(fetchClient.POST("/api/v1/brokers/{id}/start", { params: { path: { id: broker.id } } })),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["get", "/api/v1/brokers"] }),
  });

  const stopMutation = useMutation({
    mutationFn: () => unwrap(fetchClient.POST("/api/v1/brokers/{id}/stop", { params: { path: { id: broker.id } } })),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["get", "/api/v1/brokers"] }),
  });

  const deleteMutation = useMutation({
    mutationFn: () => unwrap(fetchClient.DELETE("/api/v1/brokers/{id}", { params: { path: { id: broker.id } } })),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["get", "/api/v1/brokers"] }),
  });

  const isToggling = startMutation.isPending || stopMutation.isPending;
  const isConnected = broker.status === "connected";

  return (
    <tr className="border-t border-zinc-800/60 hover:bg-white/[0.02] transition">
      <td className="px-4 py-3">
        <Link href={`/brokers/${broker.id}`} className="flex items-center gap-3 group">
          <StatusDot status={broker.status} />
          <span className="text-sm font-medium text-zinc-200 group-hover:text-white transition">
            {broker.name}
          </span>
        </Link>
      </td>
      <td className="px-4 py-3">
        <BrokerTypeBadge type={broker.broker_type} />
      </td>
      <td className="px-4 py-3">
        <span
          className={`text-xs font-medium capitalize ${
            broker.status === "connected"
              ? "text-emerald-400"
              : broker.status === "error"
                ? "text-red-400"
                : "text-zinc-500"
          }`}
        >
          {broker.status}
        </span>
      </td>
      <td className="px-4 py-3">
        {broker.last_error ? (
          <span className="text-xs text-red-400/80 truncate max-w-[200px] block" title={broker.last_error}>
            {broker.last_error}
          </span>
        ) : (
          <span className="text-xs text-zinc-600">&mdash;</span>
        )}
      </td>
      <td className="px-4 py-3">
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => isConnected ? stopMutation.mutate() : startMutation.mutate()}
            disabled={isToggling}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium bg-zinc-800 hover:bg-zinc-700 text-zinc-300 transition disabled:opacity-50"
            title={isConnected ? "Stop" : "Start"}
          >
            {isToggling ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : isConnected ? (
              <Square className="w-3.5 h-3.5" />
            ) : (
              <Play className="w-3.5 h-3.5" />
            )}
            {isConnected ? "Stop" : "Start"}
          </button>

          {confirmDelete ? (
            <div className="flex items-center gap-1">
              <button
                onClick={() => deleteMutation.mutate()}
                disabled={deleteMutation.isPending}
                className="px-2.5 py-1.5 rounded-md text-xs font-medium bg-red-500/20 text-red-400 hover:bg-red-500/30 transition disabled:opacity-50"
              >
                {deleteMutation.isPending ? "\u2026" : "Confirm"}
              </button>
              <button
                onClick={() => setConfirmDelete(false)}
                className="px-2.5 py-1.5 rounded-md text-xs font-medium bg-zinc-800 text-zinc-400 hover:bg-zinc-700 transition"
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              onClick={() => setConfirmDelete(true)}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium bg-zinc-800 hover:bg-zinc-700 text-zinc-500 hover:text-red-400 transition"
              title="Delete"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </td>
    </tr>
  );
}

type Step = 1 | 2 | 3;
type BrokerType = "redis" | "rabbitmq";

const BROKER_DEFAULTS: Record<BrokerType, string> = {
  redis: "redis://localhost:6379/0",
  rabbitmq: "amqp://guest:guest@localhost:5672//",
};

function StepIndicator({ step, current }: { step: Step; current: Step }) {
  const done = current > step;
  const active = current === step;
  return (
    <div className="flex items-center gap-2">
      <div
        className={[
          "w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold transition",
          done
            ? "bg-white text-zinc-900"
            : active
              ? "bg-white/10 text-white border border-white/20"
              : "bg-zinc-800 text-zinc-500",
        ].join(" ")}
      >
        {done ? <Check className="w-3.5 h-3.5" /> : step}
      </div>
      <span
        className={`text-xs font-medium ${
          active ? "text-white" : done ? "text-zinc-300" : "text-zinc-500"
        }`}
      >
        {step === 1 && "Broker"}
        {step === 2 && "Connect"}
        {step === 3 && "Events"}
      </span>
    </div>
  );
}

function CopyBlock({ value, label }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  function handleCopy() {
    navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div>
      {label && <p className="text-xs text-zinc-500 mb-1.5">{label}</p>}
      <div className="flex items-center gap-2 bg-zinc-800/50 rounded-lg px-4 py-3 font-mono text-sm text-zinc-200 overflow-x-auto">
        <code className="flex-1 whitespace-pre">{value}</code>
        <button
          onClick={handleCopy}
          className="shrink-0 p-1 rounded hover:bg-zinc-700/50 text-zinc-500 hover:text-zinc-200 transition"
          title="Copy"
        >
          {copied ? <Check className="w-4 h-4 text-zinc-300" /> : <Copy className="w-4 h-4" />}
        </button>
      </div>
    </div>
  );
}

function ConnectBrokerModal({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const [step, setStep] = useState<Step>(1);
  const [brokerType, setBrokerType] = useState<BrokerType>("redis");
  const [connectionUrl, setConnectionUrl] = useState(BROKER_DEFAULTS.redis);
  const [brokerName, setBrokerName] = useState("Production");
  const [testResult, setTestResult] = useState<{
    success: boolean;
    error?: string;
  } | null>(null);

  const testMutation = useMutation({
    mutationFn: () =>
      unwrap(fetchClient.POST("/api/v1/brokers/test", {
        body: {
          broker_type: brokerType,
          connection_url: connectionUrl,
        },
      })),
    onSuccess: (data) => setTestResult({ success: data.success, error: data.error ?? undefined }),
  });

  const createMutation = useMutation({
    mutationFn: () =>
      unwrap(fetchClient.POST("/api/v1/brokers", {
        body: {
          name: brokerName || `${brokerType === "redis" ? "Redis" : "RabbitMQ"} Broker`,
          broker_type: brokerType,
          connection_url: connectionUrl,
        },
      })),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["get", "/api/v1/brokers"] });
      onClose();
    },
  });

  function handleBrokerTypeChange(type: BrokerType) {
    setBrokerType(type);
    setConnectionUrl(BROKER_DEFAULTS[type]);
    setTestResult(null);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative bg-zinc-900 border border-zinc-800 rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-zinc-800">
          <div className="flex items-center gap-3">
            <Cable className="w-5 h-5 text-zinc-400" />
            <h2 className="text-lg font-semibold text-white">Connect Broker</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-zinc-800 text-zinc-500 hover:text-zinc-200 transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-6 py-5 space-y-5">
          <div className="flex items-center justify-center gap-6">
            <StepIndicator step={1} current={step} />
            <div className="w-6 h-px bg-zinc-800" />
            <StepIndicator step={2} current={step} />
            <div className="w-6 h-px bg-zinc-800" />
            <StepIndicator step={3} current={step} />
          </div>

          {step === 1 && (
            <div className="space-y-4">
              <p className="text-sm text-zinc-400">
                Which broker does your Celery use?
              </p>
              <div className="grid grid-cols-2 gap-3">
                <button
                  onClick={() => handleBrokerTypeChange("redis")}
                  className={[
                    "flex flex-col items-center gap-2 rounded-lg border px-6 py-4 text-center transition",
                    brokerType === "redis"
                      ? "border-white/20 bg-white/5 text-white"
                      : "border-zinc-800 bg-zinc-900 hover:border-zinc-700 text-zinc-400",
                  ].join(" ")}
                >
                  <Database className="w-5 h-5" />
                  <span className="text-sm font-semibold">Redis</span>
                  <span className="text-xs opacity-60">Most common</span>
                </button>
                <button
                  onClick={() => handleBrokerTypeChange("rabbitmq")}
                  className={[
                    "flex flex-col items-center gap-2 rounded-lg border px-6 py-4 text-center transition",
                    brokerType === "rabbitmq"
                      ? "border-white/20 bg-white/5 text-white"
                      : "border-zinc-800 bg-zinc-900 hover:border-zinc-700 text-zinc-400",
                  ].join(" ")}
                >
                  <Plug className="w-5 h-5" />
                  <span className="text-sm font-semibold">RabbitMQ</span>
                  <span className="text-xs opacity-60">AMQP</span>
                </button>
              </div>
              <button
                onClick={() => setStep(2)}
                className="flex items-center gap-2 px-5 py-2.5 rounded-lg bg-white text-zinc-900 text-sm font-medium hover:bg-zinc-200 transition"
              >
                Continue
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-4">
              <div>
                <label className="text-sm font-medium text-zinc-300 block mb-1.5">
                  Connection Name
                </label>
                <input
                  type="text"
                  value={brokerName}
                  onChange={(e) => setBrokerName(e.target.value)}
                  placeholder="e.g., Production Redis"
                  className="w-full px-3 py-2 rounded-lg bg-zinc-800/50 border border-zinc-700 text-white text-sm focus:outline-none focus:ring-1 focus:ring-zinc-500"
                />
              </div>
              <div>
                <label className="text-sm font-medium text-zinc-300 block mb-1.5">
                  {brokerType === "redis" ? "Redis URL" : "AMQP URL"}
                </label>
                <input
                  type="text"
                  value={connectionUrl}
                  onChange={(e) => {
                    setConnectionUrl(e.target.value);
                    setTestResult(null);
                  }}
                  placeholder={BROKER_DEFAULTS[brokerType]}
                  className="w-full px-3 py-2 rounded-lg bg-zinc-800/50 border border-zinc-700 text-white text-sm font-mono focus:outline-none focus:ring-1 focus:ring-zinc-500"
                />
                <p className="text-xs text-zinc-600 mt-1">
                  The same {brokerType === "redis" ? "Redis" : "RabbitMQ"} URL your Celery workers connect to
                </p>
              </div>

              {testResult && (
                <div
                  className={`flex items-start gap-3 p-3 rounded-lg text-sm ${
                    testResult.success
                      ? "bg-emerald-500/10 border border-emerald-500/20"
                      : "bg-red-500/10 border border-red-500/20"
                  }`}
                >
                  {testResult.success ? (
                    <>
                      <CheckCircle className="w-4 h-4 text-emerald-400 mt-0.5 shrink-0" />
                      <p className="text-emerald-400">Connection successful</p>
                    </>
                  ) : (
                    <>
                      <span className="w-4 h-4 text-red-400 mt-0.5 shrink-0 text-center">&times;</span>
                      <div>
                        <p className="text-red-400 font-medium">Connection failed</p>
                        {testResult.error && (
                          <p className="text-red-400/70 mt-0.5">{testResult.error}</p>
                        )}
                      </div>
                    </>
                  )}
                </div>
              )}

              <div className="flex items-center gap-3">
                <button
                  onClick={() => testMutation.mutate()}
                  disabled={testMutation.isPending || !connectionUrl}
                  className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-zinc-800 text-zinc-200 text-sm font-medium hover:bg-zinc-700 transition disabled:opacity-50"
                >
                  {testMutation.isPending ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Plug className="w-4 h-4" />
                  )}
                  Test
                </button>
                <button
                  onClick={() => setStep(3)}
                  disabled={!connectionUrl}
                  className="flex items-center gap-2 px-5 py-2.5 rounded-lg bg-white text-zinc-900 text-sm font-medium hover:bg-zinc-200 transition disabled:opacity-50"
                >
                  Continue
                  <ArrowRight className="w-4 h-4" />
                </button>
              </div>

              <button
                onClick={() => setStep(1)}
                className="text-xs text-zinc-500 hover:text-zinc-300 transition"
              >
                &larr; Back
              </button>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-4">
              <div className="flex items-center gap-3 mb-2">
                <Terminal className="w-5 h-5 text-zinc-400" />
                <h3 className="text-sm font-semibold text-white">Enable Worker Events</h3>
              </div>
              <p className="text-sm text-zinc-400">
                Celery workers need the <code className="text-zinc-300">--events</code> flag
                to publish task events to the broker:
              </p>
              <CopyBlock
                label="Start your worker with events enabled"
                value="celery -A myapp worker --loglevel=info --events"
              />
              <div className="p-3 rounded-lg bg-zinc-800/30 border border-zinc-800 text-sm text-zinc-400">
                <strong className="text-zinc-300">Already running?</strong>{" "}
                Enable at runtime: <code className="text-zinc-300">celery -A myapp control enable_events</code>
              </div>
              <div className="pt-1">
                <button
                  onClick={() => createMutation.mutate()}
                  disabled={createMutation.isPending}
                  className="flex items-center gap-2 px-5 py-2.5 rounded-lg bg-white text-zinc-900 text-sm font-medium hover:bg-zinc-200 transition disabled:opacity-50"
                >
                  {createMutation.isPending ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Plug className="w-4 h-4" />
                  )}
                  Connect & Start Monitoring
                </button>
                {createMutation.isError && (
                  <p className="text-sm text-red-400 mt-2">
                    {createMutation.error instanceof Error
                      ? createMutation.error.message
                      : "Failed to create broker connection"}
                  </p>
                )}
              </div>
              <button
                onClick={() => setStep(2)}
                className="text-xs text-zinc-500 hover:text-zinc-300 transition"
              >
                &larr; Back
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function BrokersPage() {
  const [showModal, setShowModal] = useState(false);

  function openModal() {
    setShowModal(true);
  }

  const { data, isLoading } = $api.useQuery(
    "get",
    "/api/v1/brokers",
    undefined,
    { refetchInterval: 10_000 },
  );

  const brokers = data?.data ?? [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white">Brokers</h1>
          <p className="text-sm text-zinc-500 mt-0.5">
            Manage your message broker connections
          </p>
        </div>
        <button
          onClick={openModal}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-white text-zinc-900 text-sm font-medium hover:bg-zinc-200 transition"
        >
          <Plug className="w-4 h-4" />
          Add Broker
        </button>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-5 h-5 animate-spin text-zinc-500" />
        </div>
      ) : brokers.length === 0 ? (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 py-16 flex flex-col items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-white/5 flex items-center justify-center">
            <Cable className="w-6 h-6 text-zinc-500" />
          </div>
          <div className="text-center">
            <p className="text-sm font-medium text-zinc-300">
              No brokers configured
            </p>
            <p className="text-sm text-zinc-600 mt-1">
              Connect your first message broker to start monitoring Celery tasks
            </p>
          </div>
          <button
            onClick={openModal}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-white text-zinc-900 text-sm font-medium hover:bg-zinc-200 transition mt-2"
          >
            <Cable className="w-4 h-4" />
            Connect Broker
          </button>
        </div>
      ) : (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 overflow-hidden">
          {brokers.some((b) => b.status === "error") && (
            <div className="flex items-center gap-2 px-4 py-2.5 bg-red-500/5 border-b border-red-500/10 text-sm text-red-400">
              <AlertCircle className="w-4 h-4 shrink-0" />
              {brokers.filter((b) => b.status === "error").length} broker
              {brokers.filter((b) => b.status === "error").length > 1 ? "s" : ""}{" "}
              with errors
            </div>
          )}

          <table className="w-full text-left">
            <thead>
              <tr className="text-xs text-zinc-500 uppercase tracking-wider">
                <th className="px-4 py-3 font-medium">Name</th>
                <th className="px-4 py-3 font-medium">Type</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Error</th>
                <th className="px-4 py-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {brokers.map((broker) => (
                <BrokerRow key={broker.id} broker={broker} />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showModal && <ConnectBrokerModal onClose={() => setShowModal(false)} />}
    </div>
  );
}
