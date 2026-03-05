import type { components } from "@/lib/api/v1";

type S = components["schemas"];

export type AuthResponse = S["AuthResponse"];
export type OrgPickerResponse = S["OrgPickerResponse"];
export type OrgSummary = S["OrgSummary"];
export type UserInfo = S["UserInfo"];
export type RegisterRequest = S["RegisterRequest"];
export type LoginRequest = S["LoginRequest"];
export type LoginResponse = AuthResponse | OrgPickerResponse;

export type TaskEvent = S["TaskEventRow"];

export type TaskState =
  | "PENDING"
  | "RECEIVED"
  | "STARTED"
  | "SUCCESS"
  | "FAILURE"
  | "RETRY"
  | "REVOKED"
  | "REJECTED";

export type TaskListParams = S["TaskListParams"];
export type RetryTaskRequest = S["RetryRequest"];

export type WorkerEvent = S["WorkerEventRow"];
export type WorkerState = S["WorkerState"];

export type AlertCondition = S["AlertCondition"];
export type AlertChannel = S["AlertChannel"];
export type ChannelDeliveryStatus = S["ChannelDeliveryStatus"];
export type AlertRule = S["AlertRule"];

export type AlertHistory = S["AlertHistoryRow"] & {
  rule_name?: string;
};

export type OverviewMetrics = S["OverviewResponse"];
export type TaskMetricsRow = S["TaskMetricsRow"];

export type ApiKey = S["ApiKey"];

export type BrokerConfig = S["BrokerConfig"];
export type BrokerStats = S["BrokerStats"];

export type NotificationSettings = S["NotificationSettings"];
export type SmtpSettings = S["SmtpSettings"];
export type WebhookDefaults = S["WebhookDefaults"];


