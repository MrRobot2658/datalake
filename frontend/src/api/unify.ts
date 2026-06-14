// 02 · Unify 模块 API（独立文件，避免并发改 client.ts）
// 对接 sql-engine unify_api.py(/unify 前缀)，全部按 tenant_id 隔离。
import { http } from "./client";
import type { Relation } from "./types";

// ── 身份解析规则 ───────────────────────────────────────────────
export interface IdentityRule {
  rule_id: string;
  identifier_type: string;
  priority: number;
  max_per_profile: number | null;
  is_unique: number | boolean;
  is_primary: number | boolean;
  merge_strategy: string | null;
  description: string | null;
  enabled: number | boolean;
}
export interface IdentityRuleInput {
  rule_id?: string | null;
  identifier_type: string;
  priority?: number;
  max_per_profile?: number | null;
  is_unique?: boolean;
  is_primary?: boolean;
  merge_strategy?: string | null;
  description?: string | null;
  enabled?: boolean;
}

export async function listIdentityRules(tenant: number): Promise<IdentityRule[]> {
  const { data } = await http.get(`/unify/identity-rules/${tenant}`);
  return data;
}
export async function upsertIdentityRule(tenant: number, body: IdentityRuleInput): Promise<IdentityRule> {
  const { data } = await http.post(`/unify/identity-rules/${tenant}`, body);
  return data;
}
export async function deleteIdentityRule(tenant: number, ruleId: string): Promise<{ ok: boolean }> {
  const { data } = await http.delete(`/unify/identity-rules/${tenant}/${ruleId}`);
  return data;
}

// ── 任意对象打标 ───────────────────────────────────────────────
export interface ObjectTag {
  tag_code: string;
  source: string;
  assigned_by: string | null;
  assigned_at: string;
}
export interface TagAssignInput {
  object_type: string;
  object_id: string;
  source?: string;
  assigned_by?: string | null;
}

export async function assignTag(tenant: number, code: string, body: TagAssignInput): Promise<ObjectTag> {
  const { data } = await http.post(`/unify/tags/${tenant}/${code}/assign`, body);
  return data;
}
export async function removeTag(
  tenant: number, code: string, objectType: string, objectId: string,
): Promise<{ ok: boolean }> {
  const { data } = await http.delete(
    `/unify/tags/${tenant}/${code}/object/${objectType}/${objectId}`,
  );
  return data;
}
export async function listObjectTags(
  tenant: number, objectType: string, objectId: string,
): Promise<{ tenant_id: number; object_type: string; object_id: string; tags: ObjectTag[] }> {
  const { data } = await http.get(`/unify/object-tags/${tenant}/${objectType}/${objectId}`);
  return data;
}

// ── 泛对象群组 ─────────────────────────────────────────────────
export interface UnifyGroup {
  group_id: number;
  group_name?: string;
  group_type?: "static" | "dynamic";
  member_object_type?: string;
  member_count?: number;
  filter_rule?: any;
  updated_at?: string;
  [k: string]: any;
}
export interface GroupRefreshResult {
  group_id: number;
  object_type: string;
  matched: number;
  member_count: number;
  source: string;
}

export async function listGroups(
  tenant: number, filterType?: "static" | "dynamic",
): Promise<UnifyGroup[]> {
  const { data } = await http.get(`/unify/groups/${tenant}`, {
    params: filterType ? { filter_type: filterType } : undefined,
  });
  return data;
}
export async function refreshGroup(tenant: number, groupId: number): Promise<GroupRefreshResult> {
  const { data } = await http.post(`/unify/groups/${tenant}/${groupId}/refresh`);
  return data;
}

// ── SQL 特征 ───────────────────────────────────────────────────
export interface SqlTrait {
  trait_id: string;
  trait_code: string;
  trait_name: string | null;
  sql_query: string;
  warehouse_type: string;
  warehouse_id: string | null;
  schedule_type: string;
  schedule_cron: string | null;
  result_table: string | null;
  enabled: number | boolean;
  last_run_time: string | null;
  last_row_count: number | null;
  result_count: number;
  created_at?: string;
}
export interface SqlTraitInput {
  trait_code: string;
  trait_name?: string | null;
  sql_query: string;
  warehouse_type?: string;
  warehouse_id?: string | null;
  schedule_type?: string;
  schedule_cron?: string | null;
  result_table?: string | null;
  object_type?: string;
  enabled?: boolean;
}
export interface SqlTraitExecuteResult {
  executed: number;
  row_count: number;
  elapsed_ms: number;
  traits: { trait_id: string; trait_code: string; rows: number }[];
}

export async function listSqlTraits(tenant: number): Promise<SqlTrait[]> {
  const { data } = await http.get(`/unify/sql-traits/${tenant}`);
  return data;
}
export async function createSqlTrait(tenant: number, body: SqlTraitInput): Promise<SqlTrait> {
  const { data } = await http.post(`/unify/sql-traits/${tenant}`, body);
  return data;
}
export async function executeSqlTrait(tenant: number, traitId: string): Promise<SqlTraitExecuteResult> {
  const { data } = await http.post(`/unify/sql-traits/${tenant}/${traitId}/execute`);
  return data;
}
export async function executeAllSqlTraits(
  tenant: number, traitId?: string | null,
): Promise<SqlTraitExecuteResult> {
  const { data } = await http.post(`/unify/sql-traits/${tenant}/execute`, { trait_id: traitId ?? null });
  return data;
}

// ── 预测模型 ───────────────────────────────────────────────────
export interface PredictionModel {
  model_id: string;
  model_name: string;
  model_type: string;
  target_event: string | null;
  features: string[];
  training_data_days: number | null;
  inference_horizon: string | null;
  enabled: number | boolean;
  last_inference_at: string | null;
  quality_score: number | null;
  created_at?: string;
}
export interface PredictionModelInput {
  model_id?: string | null;
  model_name: string;
  model_type: string;
  target_event?: string | null;
  features?: string[];
  training_data_days?: number | null;
  inference_horizon?: string | null;
  enabled?: boolean;
}
export interface InferResult {
  model_id: string;
  property_key: string;
  row_count: number;
  quality_score: number;
  elapsed_ms: number;
}

export async function listPredictions(tenant: number): Promise<PredictionModel[]> {
  const { data } = await http.get(`/unify/predictions/${tenant}`);
  return data;
}
export async function createPrediction(tenant: number, body: PredictionModelInput): Promise<PredictionModel> {
  const { data } = await http.post(`/unify/predictions/${tenant}`, body);
  return data;
}
export async function inferPrediction(tenant: number, modelId: string): Promise<InferResult> {
  const { data } = await http.post(`/unify/predictions/${tenant}/${modelId}/infer`);
  return data;
}

// ── 档案回流 Profiles Sync ─────────────────────────────────────
export interface ProfileSyncInput {
  job_id?: string | null;
  job_name?: string | null;
  target_warehouse: string;
  source_object?: string;
  tables?: string[];
  schedule?: string | null;
}
export interface ProfileSyncResult {
  job_id: string;
  run_id: string;
  status: string;
  target_warehouse: string;
  tables: string[];
  row_count: number;
}

export async function syncProfiles(tenant: number, body: ProfileSyncInput): Promise<ProfileSyncResult> {
  const { data } = await http.post(`/unify/profiles/sync/${tenant}`, body);
  return data;
}

// ── 泛对象搜索（叠加 object_tags 标签过滤）─────────────────────
export interface UnifyObjectSearchBody {
  tenant_id: number;
  object: string;
  conditions?: any[];
  relations?: Relation[];
  tag_codes?: string[];
  tag_logic?: "and" | "or";
  logic?: "AND" | "OR";
  limit?: number;
  count_only?: boolean;
}

export async function searchObjectsWithTags(body: UnifyObjectSearchBody): Promise<any> {
  const { data } = await http.post(`/unify/objects/search`, { limit: 50, ...body });
  return data;
}
