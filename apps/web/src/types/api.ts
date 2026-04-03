import type { components } from "@/lib/api/v1";

type Schemas = components["schemas"];

export type AuthResponse = Schemas["AuthResponse"];
export type OrgPickerResponse = Schemas["OrgPickerResponse"];
export type OrgSummary = Schemas["OrgSummary"];
export type UserInfo = Schemas["UserInfo"];
export type RegisterRequest = Schemas["RegisterRequest"];
export type LoginRequest = Schemas["LoginRequest"];
export type LoginResponse = AuthResponse | OrgPickerResponse;

export type TaskEvent = Schemas["TaskEventRow"];

export type TaskState =
  | "PENDING"
  | "RECEIVED"
  | "STARTED"
  | "SUCCESS"
  | "FAILURE"
  | "RETRY"
  | "REVOKED"
  | "REJECTED";

export type TaskListParams = Schemas["TaskListParams"];
export type RetryTaskRequest = Schemas["RetryRequest"];

export type WorkerEvent = Schemas["WorkerEventRow"];
export type WorkerState = Schemas["WorkerState"];
export type WorkerTaskStats = Schemas["WorkerTaskStatsRow"];
export type WorkerHealthRow = Schemas["WorkerHealthRow"];

export type AlertCondition = Schemas["AlertCondition"];
export type AlertChannel = Schemas["AlertChannel"];
export type ChannelDeliveryStatus = Schemas["ChannelDeliveryStatus"];
export type AlertRule = Schemas["AlertRule"];

export type AlertHistory = Schemas["AlertHistoryRow"] & {
  rule_name?: string;
};

export type OverviewMetrics = Schemas["OverviewResponse"];
export type TaskMetricsRow = Schemas["TaskMetricsRow"];

export type ApiKey = Schemas["ApiKey"];

export type BrokerConfig = Schemas["BrokerConfig"];
export type BrokerStats = Schemas["BrokerStats"];

export type NotificationSettings = Schemas["NotificationSettings"];
export type SmtpSettings = Schemas["SmtpSettings"];
export type WebhookDefaults = Schemas["WebhookDefaults"];

export type TaskSummaryRow = Schemas["TaskSummaryRow"];
export type FailureGroupRow = Schemas["FailureGroupRow"];
export type TaskNameStatsRow = Schemas["TaskNameStatsRow"];
export type QueueOverviewRow = Schemas["QueueOverviewRow"];

export type DagNode = Schemas["DagNode"];
export type DagEdge = Schemas["DagEdge"];
export type WorkflowDag = Schemas["WorkflowDag"];

export type SystemHealthResponse = Schemas["SystemHealthResponse"];
export type PipelineStatsResponse = Schemas["PipelineStatsResponse"];
export type ComponentHealth = Schemas["ComponentHealth"];
export type StorageInfo = Schemas["StorageInfo"];
export type TableStorageRow = Schemas["TableStorageRow"];
export type DeadLetterRow = Schemas["DeadLetterRow"];
export type DeadLetterSummary = Schemas["DeadLetterSummary"];


