// 04 · accounts —— 账户（B2B Account 对象）前端 API
// 仅本模块使用，避免并发改 client.ts。所有请求带 tenant_id（多租户隔离）。
import { http } from "./client";
import type { SearchResult } from "./types";

// ── 类型（对齐后端 accounts_api.py）────────────────────────────────────────
export interface Account {
  account_id: string;
  name?: string;
  industry?: string;
  scale?: string;
  [k: string]: any;
}

export interface AccountAggregates {
  tenant_id?: number;
  account_id?: string;
  user_count?: number;
  active_user_count?: number;
  total_gmv?: number;
  purchase_count?: number;
  product_count?: number;
  channel_count?: number;
  tags?: string[];
  properties?: Record<string, any>;
  last_update_time?: string;
  metric_date?: string;
}

export interface HierarchyNode {
  tenant_id?: number;
  account_id?: string;
  parent_account_id?: string | null;
  level?: number;
  path?: string | null;
  relationship_type?: string | null;
  properties?: Record<string, any>;
}

export interface HierarchyResult {
  node: HierarchyNode | null;
  children: HierarchyNode[];
}

export interface MergeLogEntry {
  id?: number;
  tenant_id?: number;
  master_account_id: string;
  merged_account_id: string;
  action: string; // merge / dedup / unmerge
  merged_fields?: Record<string, any>;
  user_count?: number;
  created_by?: string | null;
  created_at?: string;
}

export interface AccountDetail {
  account: Account;
  aggregates: AccountAggregates | null;
  hierarchy: HierarchyResult;
}

export interface AccountCondition {
  field: string;
  op?: string;
  value?: any;
}

export interface AggregateUpsert {
  user_count?: number;
  active_user_count?: number;
  total_gmv?: number;
  purchase_count?: number;
  product_count?: number;
  channel_count?: number;
  tags?: string[];
  properties?: Record<string, any>;
  metric_date?: string;
}

export interface HierarchyUpsert {
  parent_account_id?: string | null;
  level?: number;
  path?: string | null;
  relationship_type?: string | null;
  properties?: Record<string, any>;
}

export interface MergeRequest {
  master_account_id: string;
  merged_account_id: string;
  action?: string;
  merged_fields?: Record<string, any>;
  user_count?: number;
  created_by?: string;
}

// ── API 函数 ───────────────────────────────────────────────────────────────
export async function listAccounts(tenant: number, limit = 200): Promise<SearchResult> {
  const { data } = await http.get(`/accounts`, { params: { tenant_id: tenant, limit } });
  return data;
}

export async function searchAccounts(
  tenant: number,
  conditions: AccountCondition[],
  limit = 200,
): Promise<SearchResult> {
  const { data } = await http.post(`/accounts/search`, conditions, {
    params: { tenant_id: tenant, limit },
  });
  return data;
}

export async function getAccount(tenant: number, accountId: string): Promise<AccountDetail> {
  const { data } = await http.get(`/accounts/${encodeURIComponent(accountId)}`, {
    params: { tenant_id: tenant },
  });
  return data;
}

export async function listAccountUsers(
  tenant: number,
  accountId: string,
  limit = 200,
): Promise<SearchResult> {
  const { data } = await http.get(`/accounts/${encodeURIComponent(accountId)}/users`, {
    params: { tenant_id: tenant, limit },
  });
  return data;
}

export async function getAggregates(
  tenant: number,
  accountId: string,
): Promise<AccountAggregates> {
  const { data } = await http.get(`/accounts/${encodeURIComponent(accountId)}/aggregates`, {
    params: { tenant_id: tenant },
  });
  return data;
}

export async function putAggregates(
  tenant: number,
  accountId: string,
  body: AggregateUpsert,
): Promise<AccountAggregates> {
  const { data } = await http.put(
    `/accounts/${encodeURIComponent(accountId)}/aggregates`,
    body,
    { params: { tenant_id: tenant } },
  );
  return data;
}

export async function getHierarchy(
  tenant: number,
  accountId: string,
): Promise<HierarchyResult> {
  const { data } = await http.get(`/accounts/${encodeURIComponent(accountId)}/hierarchy`, {
    params: { tenant_id: tenant },
  });
  return data;
}

export async function putHierarchy(
  tenant: number,
  accountId: string,
  body: HierarchyUpsert,
): Promise<HierarchyNode> {
  const { data } = await http.put(
    `/accounts/${encodeURIComponent(accountId)}/hierarchy`,
    body,
    { params: { tenant_id: tenant } },
  );
  return data;
}

export async function listAccountMergeLog(
  tenant: number,
  accountId: string,
  limit = 100,
): Promise<MergeLogEntry[]> {
  const { data } = await http.get(`/accounts/${encodeURIComponent(accountId)}/merge-log`, {
    params: { tenant_id: tenant, limit },
  });
  return data;
}

export async function listAllMergeLog(tenant: number, limit = 100): Promise<MergeLogEntry[]> {
  const { data } = await http.get(`/accounts/-/merge-log`, {
    params: { tenant_id: tenant, limit },
  });
  return data;
}

export async function mergeAccounts(tenant: number, body: MergeRequest): Promise<MergeLogEntry> {
  const { data } = await http.post(`/accounts/merge`, body, {
    params: { tenant_id: tenant },
  });
  return data;
}
