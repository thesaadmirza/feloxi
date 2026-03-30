import { create } from "zustand";

type TaskUpdatePayload = {
  type: "TaskUpdate";
  task_id: string;
  task_name: string;
  state: string;
  queue: string;
  worker_id: string;
  runtime: number | null;
  timestamp: number;
};

type TaskBatchUpdatePayload = {
  type: "TaskBatchUpdate";
  count: number;
  latest: TaskUpdatePayload[];
};

type WorkerUpdatePayload = {
  type: "WorkerUpdate";
  worker_id: string;
  hostname: string;
  status: string;
  active_tasks: number;
  cpu_percent: number;
  memory_mb: number;
};

type AlertFiredPayload = {
  type: "AlertFired";
  rule_id: string;
  rule_name: string;
  severity: string;
  summary: string;
};

type MetricsSummaryPayload = {
  type: "MetricsSummary";
  throughput: number;
  failure_rate: number;
  active_workers: number;
  queue_depth: number;
};

type EventPayload =
  | TaskUpdatePayload
  | TaskBatchUpdatePayload
  | WorkerUpdatePayload
  | AlertFiredPayload
  | MetricsSummaryPayload;

type ConnectionState = "disconnected" | "connecting" | "connected";

type WsStore = {
  connectionState: ConnectionState;
  recentTasks: TaskUpdatePayload[];
  totalTaskCount: number;
  workerStates: Map<string, WorkerUpdatePayload>;
  recentAlerts: AlertFiredPayload[];
  latestMetrics: MetricsSummaryPayload | null;
  connect: () => void;
  disconnect: () => void;
};

const MAX_RECENT_TASKS = 50;
const MAX_RECENT_ALERTS = 20;
const RECONNECT_DELAY = 3000;

let ws: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let pingInterval: ReturnType<typeof setInterval> | null = null;
let rafHandle: number | null = null;
let pendingUpdates: Partial<WsStore>[] = [];

function flushPendingUpdates(
  set: (partial: Partial<WsStore> | ((state: WsStore) => Partial<WsStore>)) => void,
  get: () => WsStore
) {
  rafHandle = null;
  if (pendingUpdates.length === 0) return;

  const updates = pendingUpdates;
  pendingUpdates = [];

  const state = get();
  let recentTasks = state.recentTasks;
  let totalTaskCount = state.totalTaskCount;
  let workerStates = state.workerStates;
  let recentAlerts = state.recentAlerts;
  let latestMetrics = state.latestMetrics;
  let hasWorkerChange = false;

  for (const update of updates) {
    if (update.recentTasks) {
      recentTasks = update.recentTasks;
    }
    if (update.totalTaskCount !== undefined) {
      totalTaskCount = update.totalTaskCount;
    }
    if (update.workerStates) {
      workerStates = update.workerStates;
      hasWorkerChange = true;
    }
    if (update.recentAlerts) {
      recentAlerts = update.recentAlerts;
    }
    if (update.latestMetrics !== undefined) {
      latestMetrics = update.latestMetrics;
    }
  }

  const merged: Partial<WsStore> = {
    recentTasks,
    totalTaskCount,
    recentAlerts,
    latestMetrics,
  };

  if (hasWorkerChange) {
    merged.workerStates = workerStates;
  }

  set(merged);
}

function scheduleUpdate(
  update: Partial<WsStore>,
  set: (partial: Partial<WsStore> | ((state: WsStore) => Partial<WsStore>)) => void,
  get: () => WsStore
) {
  pendingUpdates.push(update);
  if (rafHandle === null) {
    rafHandle = requestAnimationFrame(() => flushPendingUpdates(set, get));
  }
}

export const useWsStore = create<WsStore>((set, get) => ({
  connectionState: "disconnected",
  recentTasks: [],
  totalTaskCount: 0,
  workerStates: new Map(),
  recentAlerts: [],
  latestMetrics: null,

  connect: () => {
    if (ws && ws.readyState <= WebSocket.OPEN) return;

    set({ connectionState: "connecting" });

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";

    ws = new WebSocket(`${protocol}//${window.location.host}/ws/dashboard`);

    ws.onopen = () => {
      set({ connectionState: "connected" });

      pingInterval = setInterval(() => {
        if (ws?.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "Ping" }));
        }
      }, 30_000);
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === "Event" && msg.payload) {
          handleEvent(msg.payload as EventPayload, set, get);
        }
      } catch {
        /* ignore malformed */
      }
    };

    ws.onclose = () => {
      cleanup();
      set({ connectionState: "disconnected" });
      scheduleReconnect(get);
    };

    ws.onerror = () => {
      ws?.close();
    };
  },

  disconnect: () => {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    cleanup();
    set({ connectionState: "disconnected" });
  },
}));

function cleanup() {
  if (pingInterval) {
    clearInterval(pingInterval);
    pingInterval = null;
  }
  if (rafHandle !== null) {
    cancelAnimationFrame(rafHandle);
    rafHandle = null;
    pendingUpdates = [];
  }
  if (ws) {
    ws.onclose = null;
    ws.onerror = null;
    ws.onmessage = null;
    ws.close();
    ws = null;
  }
}

function scheduleReconnect(get: () => WsStore) {
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    if (typeof window !== "undefined") {
      get().connect();
    }
  }, RECONNECT_DELAY);
}

function handleEvent(
  payload: EventPayload,
  set: (partial: Partial<WsStore> | ((state: WsStore) => Partial<WsStore>)) => void,
  get: () => WsStore
) {
  switch (payload.type) {
    case "TaskUpdate":
      scheduleUpdate(
        {
          recentTasks: [payload, ...get().recentTasks].slice(0, MAX_RECENT_TASKS),
          totalTaskCount: get().totalTaskCount + 1,
        },
        set,
        get
      );
      break;

    case "TaskBatchUpdate":
      scheduleUpdate(
        {
          recentTasks: [...payload.latest, ...get().recentTasks].slice(0, MAX_RECENT_TASKS),
          totalTaskCount: get().totalTaskCount + payload.count,
        },
        set,
        get
      );
      break;

    case "WorkerUpdate": {
      const updated = new Map(get().workerStates);
      updated.set(payload.worker_id, payload);
      scheduleUpdate({ workerStates: updated }, set, get);
      break;
    }

    case "AlertFired":
      scheduleUpdate(
        {
          recentAlerts: [payload, ...get().recentAlerts].slice(0, MAX_RECENT_ALERTS),
        },
        set,
        get
      );
      break;

    case "MetricsSummary":
      scheduleUpdate({ latestMetrics: payload }, set, get);
      break;
  }
}
