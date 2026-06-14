// 08 · monitor 模块 API —— 投递监控 / 指标聚合 / 告警
// 独立文件，避免与 client.ts 并发冲突；统一走 /api（dev: vite 代理，prod: nginx 同源）。
// 对标 Twilio Segment 的 Monitor / Delivery Overview / Sources Debugger。
import { http } from "./client";

// ════════════════════════════════════════════════════════════════════════
// 类型定义
// ════════════════════════════════════════════════════════════════════════

export interface MonitorOverview {
  tenant_id: number;
  source: string | null;
  window_minutes: number;
  events_total: number;
  success_count: number;
  failed_count: number;
  success_rate: number | null;
  error_rate: number | null;
  avg_latency_p50: number | null;
  avg_latency_p95: number | null;
  avg_latency_p99: number | null;
  bucket_count: number;
}

export interface MetricBucket {
  id: number;
  tenant_id: number;
  bucket_ts: string;
  source: string;
  events_total: number;
  success_count: number;
  failed_count: number;
  latency_ms_p50: number | null;
  latency_ms_p95: number | null;
  latency_ms_p99: number | null;
}

export interface SourceHealth {
  source: string;
  events_total: number;
  success_count: number;
  failed_count: number;
  last_bucket_ts: string | null;
  success_rate: number | null;
}

export type DeliveryStatus = "success" | "failed" | "retry" | "skipped" | string;

export interface DeliveryLog {
  id: number;
  tenant_id: number;
  ts: string;
  source: string;
  event_name: string | null;
  destination: string | null;
  status: DeliveryStatus;
  http_code: number | null;
  latency_ms: number | null;
  error_message: string | null;
  event_id: string | null;
  detail: Record<string, any> | null;
}

export interface DeliveryStat {
  dimension: string | null;
  cnt: number;
  success_count: number;
  failed_count: number;
  avg_latency: number | null;
}

export type AlertMetric = "success_rate" | "event_count" | "error_rate" | "latency_p95";
export type AlertOperator = "lt" | "gt" | "eq" | "gte" | "lte";
export type AlertSeverity = "high" | "medium" | "low";

export interface AlertRule {
  id: number;
  tenant_id: number;
  name: string;
  metric: AlertMetric | string;
  operator: AlertOperator | string;
  threshold: number;
  window_minutes: number;
  scope: string | null;
  scope_value: string | null;
  channel: string;
  channel_config: Record<string, any> | null;
  severity: AlertSeverity | string;
  enabled: number;
  created_at: string | null;
  updated_at: string | null;
}

export type AlertEventStatus = "triggered" | "acknowledged" | "resolved" | string;

export interface AlertEvent {
  id: number;
  tenant_id: number;
  rule_id: number;
  fired_at: string;
  metric_value: number | null;
  status: AlertEventStatus;
  detail: Record<string, any> | null;
  acknowledged_at: string | null;
  acknowledged_by: string | null;
  resolved_at: string | null;
  // list_events JOIN 附带
  rule_name?: string | null;
  metric?: string | null;
  severity?: string | null;
}

export interface EvaluateResult {
  rule_id: number;
  metric: string;
  operator: string;
  threshold: number;
  metric_value: number | null;
  breached: boolean;
  window_minutes: number;
  fired_event: AlertEvent | null;
}

// ════════════════════════════════════════════════════════════════════════
// 指标 / 总览
// ════════════════════════════════════════════════════════════════════════

export async function getOverview(
  tenant_id: number,
  opts: { source?: string; window_minutes?: number } = {},
): Promise<MonitorOverview> {
  const { data } = await http.get(`/monitor/overview`, {
    params: { tenant_id, ...opts },
  });
  return data;
}

export async function listMetrics(
  tenant_id: number,
  opts: { source?: string; start?: string; end?: string; limit?: number } = {},
): Promise<MetricBucket[]> {
  const { data } = await http.get(`/monitor/metrics`, {
    params: { tenant_id, ...opts },
  });
  return data;
}

export async function upsertMetric(
  tenant_id: number,
  body: {
    bucket_ts: string;
    source?: string;
    events_total?: number;
    success_count?: number;
    failed_count?: number;
    latency_ms_p50?: number;
    latency_ms_p95?: number;
    latency_ms_p99?: number;
  },
): Promise<MetricBucket> {
  const { data } = await http.post(`/monitor/metrics`, body, {
    params: { tenant_id },
  });
  return data;
}

export async function listSources(tenant_id: number): Promise<SourceHealth[]> {
  const { data } = await http.get(`/monitor/sources`, { params: { tenant_id } });
  return data;
}

// ════════════════════════════════════════════════════════════════════════
// 投递日志
// ════════════════════════════════════════════════════════════════════════

export async function listDeliveryLogs(
  tenant_id: number,
  opts: {
    source?: string;
    destination?: string;
    status?: string;
    event_name?: string;
    start?: string;
    end?: string;
    limit?: number;
  } = {},
): Promise<DeliveryLog[]> {
  const { data } = await http.get(`/monitor/delivery-logs`, {
    params: { tenant_id, ...opts },
  });
  return data;
}

export async function createDeliveryLog(
  tenant_id: number,
  body: {
    ts?: string;
    source: string;
    event_name?: string;
    destination?: string;
    status?: string;
    http_code?: number;
    latency_ms?: number;
    error_message?: string;
    event_id?: string;
    detail?: Record<string, any>;
  },
): Promise<DeliveryLog> {
  const { data } = await http.post(`/monitor/delivery-logs`, body, {
    params: { tenant_id },
  });
  return data;
}

export async function getDeliveryStats(
  tenant_id: number,
  opts: { group_by?: "status" | "source" | "destination" | "event_name"; window_minutes?: number } = {},
): Promise<DeliveryStat[]> {
  const { data } = await http.get(`/monitor/delivery-stats`, {
    params: { tenant_id, ...opts },
  });
  return data;
}

// ════════════════════════════════════════════════════════════════════════
// 告警规则
// ════════════════════════════════════════════════════════════════════════

export async function listAlertRules(
  tenant_id: number,
  enabled?: boolean,
): Promise<AlertRule[]> {
  const { data } = await http.get(`/monitor/alert-rules`, {
    params: { tenant_id, enabled },
  });
  return data;
}

export async function createAlertRule(
  tenant_id: number,
  body: {
    name: string;
    metric: AlertMetric | string;
    operator: AlertOperator | string;
    threshold: number;
    window_minutes?: number;
    scope?: string;
    scope_value?: string;
    channel: string;
    channel_config?: Record<string, any>;
    severity?: AlertSeverity | string;
    enabled?: boolean;
  },
): Promise<AlertRule> {
  const { data } = await http.post(`/monitor/alert-rules`, body, {
    params: { tenant_id },
  });
  return data;
}

export async function getAlertRule(
  tenant_id: number,
  rule_id: number,
): Promise<AlertRule> {
  const { data } = await http.get(`/monitor/alert-rules/${rule_id}`, {
    params: { tenant_id },
  });
  return data;
}

export async function updateAlertRule(
  tenant_id: number,
  rule_id: number,
  body: Partial<{
    name: string;
    metric: string;
    operator: string;
    threshold: number;
    window_minutes: number;
    scope: string;
    scope_value: string;
    channel: string;
    channel_config: Record<string, any>;
    severity: string;
    enabled: boolean;
  }>,
): Promise<AlertRule> {
  const { data } = await http.put(`/monitor/alert-rules/${rule_id}`, body, {
    params: { tenant_id },
  });
  return data;
}

export async function deleteAlertRule(
  tenant_id: number,
  rule_id: number,
): Promise<{ deleted: boolean; id: number }> {
  const { data } = await http.delete(`/monitor/alert-rules/${rule_id}`, {
    params: { tenant_id },
  });
  return data;
}

export async function evaluateAlertRule(
  tenant_id: number,
  rule_id: number,
  fire = true,
): Promise<EvaluateResult> {
  const { data } = await http.post(
    `/monitor/alert-rules/${rule_id}/evaluate`,
    null,
    { params: { tenant_id, fire } },
  );
  return data;
}

// ════════════════════════════════════════════════════════════════════════
// 告警触发记录
// ════════════════════════════════════════════════════════════════════════

export async function listAlertEvents(
  tenant_id: number,
  opts: { rule_id?: number; status?: string; limit?: number } = {},
): Promise<AlertEvent[]> {
  const { data } = await http.get(`/monitor/alert-events`, {
    params: { tenant_id, ...opts },
  });
  return data;
}

export async function createAlertEvent(
  tenant_id: number,
  body: { rule_id: number; fired_at?: string; metric_value?: number; detail?: Record<string, any> },
): Promise<AlertEvent> {
  const { data } = await http.post(`/monitor/alert-events`, body, {
    params: { tenant_id },
  });
  return data;
}

export async function getAlertEvent(
  tenant_id: number,
  event_id: number,
): Promise<AlertEvent> {
  const { data } = await http.get(`/monitor/alert-events/${event_id}`, {
    params: { tenant_id },
  });
  return data;
}

export async function acknowledgeAlertEvent(
  tenant_id: number,
  event_id: number,
  acknowledged_by?: string,
): Promise<AlertEvent> {
  const { data } = await http.post(
    `/monitor/alert-events/${event_id}/acknowledge`,
    { acknowledged_by },
    { params: { tenant_id } },
  );
  return data;
}

export async function resolveAlertEvent(
  tenant_id: number,
  event_id: number,
): Promise<AlertEvent> {
  const { data } = await http.post(
    `/monitor/alert-events/${event_id}/resolve`,
    null,
    { params: { tenant_id } },
  );
  return data;
}
