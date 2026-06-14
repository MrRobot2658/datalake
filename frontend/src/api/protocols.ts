// 06 · protocols 模块 API —— 埋点计划 / 计划事件 / 违规 / 转换 / 校验
// 独立文件，避免并发修改 client.ts。所有请求按 tenant_id 隔离。
import { http } from "./client";

// ──────────────────────────── 类型 ────────────────────────────

export interface TrackingPlan {
  id: number;
  tenant_id: number;
  name: string;
  description?: string | null;
  sources?: string[] | null;
  enabled: number | boolean;
  created_at?: string;
  updated_at?: string;
}

export interface TrackingPlanCreate {
  name: string;
  description?: string | null;
  sources?: string[] | null;
  enabled?: boolean;
}
export type TrackingPlanUpdate = Partial<TrackingPlanCreate>;

export interface PlanEvent {
  id: number;
  tenant_id: number;
  plan_id: number;
  event: string;
  type: string;
  properties_json?: Record<string, any> | null;
  required?: string[] | null;
  status: string;
  created_at?: string;
  updated_at?: string;
}

export interface PlanEventCreate {
  event: string;
  type?: string;
  properties_json?: Record<string, any> | null;
  required?: string[] | null;
  status?: string;
}
export type PlanEventUpdate = Partial<PlanEventCreate>;

export interface Violation {
  id: number;
  tenant_id: number;
  event: string;
  issue: string;
  count: number;
  source?: string | null;
  severity: string;
  last_seen?: string;
  created_at?: string;
}

export interface ViolationRecord {
  event: string;
  issue: string;
  count?: number;
  source?: string | null;
  severity?: string;
}

export interface Transformation {
  id: number;
  tenant_id: number;
  name: string;
  scope?: string | null;
  type: string;
  config?: Record<string, any> | null;
  enabled: number | boolean;
  description?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface TransformationCreate {
  name: string;
  scope?: string | null;
  type?: string;
  config?: Record<string, any> | null;
  enabled?: boolean;
  description?: string | null;
}
export type TransformationUpdate = Partial<TransformationCreate>;

export interface ValidateRequest {
  event: string;
  properties?: Record<string, any>;
  source?: string | null;
  record_violation?: boolean;
}

export interface ValidateResult {
  valid: boolean;
  event: string;
  issues: string[];
  recorded_violations: Violation[];
}

// ──────────────────────────── 埋点计划 ────────────────────────────

export async function listTrackingPlans(tenant: number): Promise<TrackingPlan[]> {
  const { data } = await http.get(`/protocols/tracking-plans`, { params: { tenant_id: tenant } });
  return data;
}

export async function getTrackingPlan(tenant: number, planId: number): Promise<TrackingPlan> {
  const { data } = await http.get(`/protocols/tracking-plans/${planId}`, { params: { tenant_id: tenant } });
  return data;
}

export async function createTrackingPlan(tenant: number, body: TrackingPlanCreate): Promise<TrackingPlan> {
  const { data } = await http.post(`/protocols/tracking-plans`, body, { params: { tenant_id: tenant } });
  return data;
}

export async function updateTrackingPlan(tenant: number, planId: number, body: TrackingPlanUpdate): Promise<TrackingPlan> {
  const { data } = await http.put(`/protocols/tracking-plans/${planId}`, body, { params: { tenant_id: tenant } });
  return data;
}

export async function deleteTrackingPlan(tenant: number, planId: number): Promise<{ deleted: boolean; id: number }> {
  const { data } = await http.delete(`/protocols/tracking-plans/${planId}`, { params: { tenant_id: tenant } });
  return data;
}

// ──────────────────────────── 计划事件 ────────────────────────────

export async function listPlanEvents(tenant: number, planId: number): Promise<PlanEvent[]> {
  const { data } = await http.get(`/protocols/tracking-plans/${planId}/events`, { params: { tenant_id: tenant } });
  return data;
}

export async function createPlanEvent(tenant: number, planId: number, body: PlanEventCreate): Promise<PlanEvent> {
  const { data } = await http.post(`/protocols/tracking-plans/${planId}/events`, body, { params: { tenant_id: tenant } });
  return data;
}

export async function updatePlanEvent(tenant: number, eventId: number, body: PlanEventUpdate): Promise<PlanEvent> {
  const { data } = await http.put(`/protocols/tracking-plans/events/${eventId}`, body, { params: { tenant_id: tenant } });
  return data;
}

export async function deletePlanEvent(tenant: number, eventId: number): Promise<{ deleted: boolean; id: number }> {
  const { data } = await http.delete(`/protocols/tracking-plans/events/${eventId}`, { params: { tenant_id: tenant } });
  return data;
}

export async function validateEvent(tenant: number, planId: number, body: ValidateRequest): Promise<ValidateResult> {
  const { data } = await http.post(`/protocols/tracking-plans/${planId}/validate`, body, { params: { tenant_id: tenant } });
  return data;
}

// ──────────────────────────── 违规 ────────────────────────────

export async function listViolations(
  tenant: number,
  opts?: { severity?: string; source?: string; limit?: number },
): Promise<Violation[]> {
  const { data } = await http.get(`/protocols/violations`, { params: { tenant_id: tenant, ...opts } });
  return data;
}

export async function recordViolation(tenant: number, body: ViolationRecord): Promise<Violation> {
  const { data } = await http.post(`/protocols/violations`, body, { params: { tenant_id: tenant } });
  return data;
}

export async function deleteViolation(tenant: number, violationId: number): Promise<{ deleted: boolean; id: number }> {
  const { data } = await http.delete(`/protocols/violations/${violationId}`, { params: { tenant_id: tenant } });
  return data;
}

// ──────────────────────────── 转换规则 ────────────────────────────

export async function listTransformations(tenant: number, scope?: string): Promise<Transformation[]> {
  const { data } = await http.get(`/protocols/transformations`, { params: { tenant_id: tenant, scope } });
  return data;
}

export async function getTransformation(tenant: number, tfId: number): Promise<Transformation> {
  const { data } = await http.get(`/protocols/transformations/${tfId}`, { params: { tenant_id: tenant } });
  return data;
}

export async function createTransformation(tenant: number, body: TransformationCreate): Promise<Transformation> {
  const { data } = await http.post(`/protocols/transformations`, body, { params: { tenant_id: tenant } });
  return data;
}

export async function updateTransformation(tenant: number, tfId: number, body: TransformationUpdate): Promise<Transformation> {
  const { data } = await http.put(`/protocols/transformations/${tfId}`, body, { params: { tenant_id: tenant } });
  return data;
}

export async function deleteTransformation(tenant: number, tfId: number): Promise<{ deleted: boolean; id: number }> {
  const { data } = await http.delete(`/protocols/transformations/${tfId}`, { params: { tenant_id: tenant } });
  return data;
}
