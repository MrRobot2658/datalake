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

export async function confirmSegment(
  tenant: number,
  segment_code: string,
  segment_name: string,
  rule: DslRule,
): Promise<any> {
  const { data } = await http.post(`/agent/segment/confirm`, {
    tenant_id: tenant,
    segment_code,
    segment_name,
    rule,
  });
  return data;
}

// ETL
export interface EtlFieldMap { target: string; source?: string; const?: any }
export interface EtlBody {
  tenant_id: number;
  target_object: string;
  source: { type: string; csv?: string; rows?: any[]; delimiter?: string };
  mapping: EtlFieldMap[];
  link?: { rel_type: string; dst_type: string; dst_id_source: string };
  limit_preview?: number;
}
export async function etlPreview(body: EtlBody) {
  const { data } = await http.post(`/etl/preview`, body);
  return data as {
    target_object: string; total_rows: number; source_columns: string[];
    preview: Record<string, any>[]; issues: string[];
  };
}
export async function etlImport(body: EtlBody) {
  const { data } = await http.post(`/etl/import`, body);
  return data as {
    target_object: string; total_rows: number; imported: number;
    relations: number; failed: number; errors: { row: number; error: string }[];
  };
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
