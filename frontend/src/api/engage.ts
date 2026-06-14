// 05 · engage —— 触达模块 API（旅程 Journeys + 群发 Broadcasts）
// 复用 client.ts 的 axios 实例（baseURL=/api），独立成文件避免并发改 client.ts。
import { http } from "./client";
import type { DslRule } from "./types";

// ════════════════════════════════════════════════════════════════════════
// 类型（与 services/sql-engine/engage_api.py 对齐）
// ════════════════════════════════════════════════════════════════════════

export type JourneyStatus = "draft" | "active" | "paused" | "archived";
export type ChannelType = "email" | "sms" | "push" | "wechat";
export type BroadcastStatus =
  | "draft" | "scheduled" | "sending" | "sent" | "failed";

export interface JourneyStep {
  step_id?: number;
  journey_id?: number;
  tenant_id?: number;
  step_order: number;
  step_type?: string | null;        // action/wait/split/exit
  step_name?: string | null;
  action_type?: string | null;
  destination_id?: string | null;
  wait_duration_hours?: number | null;
  condition_logic?: string | null;  // and/or
  conditions?: any[] | null;
  next_steps?: any[] | null;
}

export interface Journey {
  journey_id: number;
  tenant_id: number;
  journey_code: string;
  journey_name?: string | null;
  description?: string | null;
  trigger_type?: string | null;     // segment_entry/event/schedule
  trigger_condition?: Record<string, any> | null;
  base_segment_id?: number | null;
  visual_config?: Record<string, any> | null;
  status: JourneyStatus;
  created_by?: string | null;
  created_at?: string;
  updated_at?: string;
  steps?: JourneyStep[];
}

export interface JourneyCreate {
  tenant_id: number;
  journey_code: string;
  journey_name?: string;
  description?: string;
  trigger_type?: string;
  trigger_condition?: Record<string, any>;
  base_segment_id?: number;
  visual_config?: Record<string, any>;
  status?: JourneyStatus;
  created_by?: string;
}

export interface JourneyUpdate {
  journey_name?: string;
  description?: string;
  trigger_type?: string;
  trigger_condition?: Record<string, any>;
  base_segment_id?: number;
  visual_config?: Record<string, any>;
  status?: JourneyStatus;
}

export interface JourneyState {
  state_id: number;
  tenant_id: number;
  journey_id: number;
  one_id?: string;
  current_step_id?: number | null;
  status: string;                   // active/completed/exited
  entered_at?: string;
  updated_at?: string;
}

export interface JourneyStats {
  journey_id: number;
  total: number;
  active: number;
  completed: number;
  exited: number;
  by_status: Record<string, number>;
}

export interface Broadcast {
  broadcast_id: number;
  tenant_id: number;
  broadcast_code: string;
  broadcast_name?: string | null;
  segment_id?: number | null;
  destination_id?: string | null;
  channel_type?: ChannelType | null;
  subject?: string | null;
  content_template?: string | null;
  estimated_size: number;
  scheduled_at?: string | null;
  sent_at?: string | null;
  status: BroadcastStatus;
  created_by?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface BroadcastCreate {
  tenant_id: number;
  broadcast_code: string;
  broadcast_name?: string;
  segment_id?: number;
  destination_id?: string;
  channel_type?: ChannelType;
  subject?: string;
  content_template?: string;
  estimated_size?: number;
  scheduled_at?: string;
  created_by?: string;
}

export interface BroadcastUpdate {
  broadcast_name?: string;
  segment_id?: number;
  destination_id?: string;
  channel_type?: ChannelType;
  subject?: string;
  content_template?: string;
  estimated_size?: number;
  scheduled_at?: string;
  status?: BroadcastStatus;
}

export interface BroadcastSend {
  send_id: number;
  tenant_id: number;
  broadcast_id: number;
  one_id?: string;
  status: string;                   // sent/delivered/bounced/opened/clicked
  sent_at?: string | null;
  opened_at?: string | null;
  clicked_at?: string | null;
}

export interface BroadcastStats {
  total: number;
  sent: number;
  delivered: number;
  bounced: number;
  opened: number;
  clicked: number;
  opened_any: number;
  clicked_any: number;
}

export interface AudienceEstimate {
  estimate: number;
  elapsed_ms: number;
  sql: string;
}

// ════════════════════════════════════════════════════════════════════════
// 旅程 Journeys
// ════════════════════════════════════════════════════════════════════════

export async function listJourneys(tenant: number, status?: JourneyStatus): Promise<Journey[]> {
  const { data } = await http.get(`/engage/journeys`, { params: { tenant_id: tenant, status } });
  return data;
}

export async function getJourney(tenant: number, journeyId: number): Promise<Journey> {
  const { data } = await http.get(`/engage/journeys/${journeyId}`, { params: { tenant_id: tenant } });
  return data;
}

export async function createJourney(body: JourneyCreate): Promise<Journey> {
  const { data } = await http.post(`/engage/journeys`, body);
  return data;
}

export async function updateJourney(
  tenant: number, journeyId: number, body: JourneyUpdate,
): Promise<Journey> {
  const { data } = await http.put(`/engage/journeys/${journeyId}`, body, {
    params: { tenant_id: tenant },
  });
  return data;
}

export async function setJourneyStatus(
  tenant: number, journeyId: number, status: JourneyStatus,
): Promise<Journey> {
  const { data } = await http.post(`/engage/journeys/${journeyId}/status`, { status }, {
    params: { tenant_id: tenant },
  });
  return data;
}

export async function deleteJourney(tenant: number, journeyId: number): Promise<{ deleted: boolean }> {
  const { data } = await http.delete(`/engage/journeys/${journeyId}`, {
    params: { tenant_id: tenant },
  });
  return data;
}

export async function listJourneySteps(tenant: number, journeyId: number): Promise<JourneyStep[]> {
  const { data } = await http.get(`/engage/journeys/${journeyId}/steps`, {
    params: { tenant_id: tenant },
  });
  return data;
}

export async function replaceJourneySteps(
  tenant: number, journeyId: number, steps: JourneyStep[],
): Promise<JourneyStep[]> {
  const { data } = await http.put(`/engage/journeys/${journeyId}/steps`, {
    tenant_id: tenant, steps,
  });
  return data;
}

export async function listJourneyState(
  tenant: number, journeyId: number, status?: string, limit = 50,
): Promise<JourneyState[]> {
  const { data } = await http.get(`/engage/journeys/${journeyId}/state`, {
    params: { tenant_id: tenant, status, limit },
  });
  return data;
}

export async function getJourneyStats(tenant: number, journeyId: number): Promise<JourneyStats> {
  const { data } = await http.get(`/engage/journeys/${journeyId}/stats`, {
    params: { tenant_id: tenant },
  });
  return data;
}

// ════════════════════════════════════════════════════════════════════════
// 群发 Broadcasts
// ════════════════════════════════════════════════════════════════════════

export async function listBroadcasts(tenant: number, status?: BroadcastStatus): Promise<Broadcast[]> {
  const { data } = await http.get(`/engage/broadcasts`, { params: { tenant_id: tenant, status } });
  return data;
}

export async function getBroadcast(tenant: number, broadcastId: number): Promise<Broadcast> {
  const { data } = await http.get(`/engage/broadcasts/${broadcastId}`, {
    params: { tenant_id: tenant },
  });
  return data;
}

export async function createBroadcast(body: BroadcastCreate): Promise<Broadcast> {
  const { data } = await http.post(`/engage/broadcasts`, body);
  return data;
}

export async function updateBroadcast(
  tenant: number, broadcastId: number, body: BroadcastUpdate,
): Promise<Broadcast> {
  const { data } = await http.put(`/engage/broadcasts/${broadcastId}`, body, {
    params: { tenant_id: tenant },
  });
  return data;
}

export async function deleteBroadcast(
  tenant: number, broadcastId: number,
): Promise<{ deleted: boolean }> {
  const { data } = await http.delete(`/engage/broadcasts/${broadcastId}`, {
    params: { tenant_id: tenant },
  });
  return data;
}

export async function sendBroadcast(tenant: number, broadcastId: number): Promise<Broadcast> {
  const { data } = await http.post(`/engage/broadcasts/${broadcastId}/send`, null, {
    params: { tenant_id: tenant },
  });
  return data;
}

export async function listBroadcastSends(
  tenant: number, broadcastId: number, status?: string, limit = 100,
): Promise<BroadcastSend[]> {
  const { data } = await http.get(`/engage/broadcasts/${broadcastId}/sends`, {
    params: { tenant_id: tenant, status, limit },
  });
  return data;
}

export async function getBroadcastStats(tenant: number, broadcastId: number): Promise<BroadcastStats> {
  const { data } = await http.get(`/engage/broadcasts/${broadcastId}/stats`, {
    params: { tenant_id: tenant },
  });
  return data;
}

// ════════════════════════════════════════════════════════════════════════
// 触达人数预估（复用 DSL 路径，绝不手拼 SQL）
// ════════════════════════════════════════════════════════════════════════

export async function estimateAudience(
  tenant: number, payload: { segment_code?: string; dsl?: DslRule },
): Promise<AudienceEstimate> {
  const { data } = await http.post(`/engage/estimate-audience`, {
    tenant_id: tenant, ...payload,
  });
  return data;
}
