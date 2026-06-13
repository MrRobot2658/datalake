import axios from "axios";
import type {
  DraftResult,
  DslRule,
  Metadata,
  Relation,
  SearchResult,
} from "./types";

// 开发态 baseURL 走 vite 代理 /api → sql-engine；生产同源由 nginx 转发。
export const http = axios.create({ baseURL: "/api", timeout: 45000 });

export async function getMetadata(tenant: number): Promise<Metadata> {
  const { data } = await http.get(`/metadata/${tenant}/fields`);
  return data;
}

export interface SearchBody {
  tenant_id: number;
  object: string;
  conditions?: any[];
  relations?: Relation[];
  logic?: "AND" | "OR";
  limit?: number;
  count_only?: boolean;
}

export async function searchObjects(body: SearchBody): Promise<SearchResult> {
  const { data } = await http.post(`/objects/search`, { limit: 50, ...body });
  return data;
}

export async function estimate(
  tenant: number,
  rule: DslRule,
): Promise<{ estimate: number; elapsed_ms: number; sql: string }> {
  const { data } = await http.post(`/dsl/estimate`, { tenant_id: tenant, ...rule });
  return data;
}

export async function validateRule(
  tenant: number,
  rule: DslRule,
): Promise<{ ok: boolean; errors: string[] }> {
  const { data } = await http.post(`/dsl/validate`, { tenant_id: tenant, ...rule });
  return data;
}

export async function draftSegment(
  tenant: number,
  question: string,
): Promise<DraftResult> {
  const { data } = await http.post(`/agent/segment/draft`, {
    tenant_id: tenant,
    question,
  });
  return data;
}

// 标签 / 群组(segment)
export async function listTags(tenant: number) {
  const { data } = await http.get(`/tags/${tenant}`);
  return data as any[];
}
export async function listSegments(tenant: number) {
  const { data } = await http.get(`/segments/${tenant}`);
  return data as any[];
}
