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
  | WorkerUpdatePayload
  | AlertFiredPayload
  | MetricsSummaryPayload;

type ConnectionState = "disconnected" | "connecting" | "connected";

type WsStore = {
  connectionState: ConnectionState;
  recentTasks: TaskUpdatePayload[];
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

export const useWsStore = create<WsStore>((set, get) => ({
  connectionState: "disconnected",
  recentTasks: [],
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
        /* ignore malformed messages */
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
  _get: () => WsStore
) {
  switch (payload.type) {
    case "TaskUpdate":
      set((state) => ({
        recentTasks: [payload, ...state.recentTasks].slice(0, MAX_RECENT_TASKS),
      }));
      break;

    case "WorkerUpdate":
      set((state) => {
        const updated = new Map(state.workerStates);
        updated.set(payload.worker_id, payload);
        return { workerStates: updated };
      });
      break;

    case "AlertFired":
      set((state) => ({
        recentAlerts: [payload, ...state.recentAlerts].slice(
          0,
          MAX_RECENT_ALERTS
        ),
      }));
      break;

    case "MetricsSummary":
      set({ latestMetrics: payload });
      break;
  }
}
