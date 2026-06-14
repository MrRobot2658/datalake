// 07 · privacy 模块 API —— 隐私合规（PII 管控 / 同意管理 / 删除与抑制 / 审计）
// 独立文件，避免与 client.ts 并发冲突；统一走 /api（dev: vite 代理，prod: nginx 同源）。
import { http } from "./client";

// ════════════════════════════════════════════════════════════════════════
// 类型定义
// ════════════════════════════════════════════════════════════════════════

export type PiiAction = "hash" | "block" | "allow" | "mask" | "drop" | "encrypt";

export interface PiiDetectedField {
  object: string;
  field: string;
  category: string;
  confidence: number;
  suggested_action: PiiAction;
  already_governed: boolean;
  existing_rule_id: number | null;
}

export interface PiiScanResult {
  tenant_id: number;
  scan_depth: string;
  scanned_fields: number;
  detected_fields: PiiDetectedField[];
}

export interface PiiRule {
  rule_id: number;
  tenant_id: number;
  field_name: string;
  category: string | null;
  action: PiiAction | string;
  scope: string | null;
  source: string | null;
  target_objects: string[] | null;
  created_by: string | null;
  is_active: number;
  created_at: string | null;
  updated_at: string | null;
}

export interface ConsentCategory {
  category_id: number;
  tenant_id: number;
  category_name: string;
  description: string | null;
  is_required: number;
  vendor_list: string[] | null;
  vendors: string[];
  optedIn_pct: number;
  created_by: string | null;
  created_at: string | null;
  updated_at: string | null;
}

export interface ConsentRecord {
  category_id: number;
  category_name: string | null;
  granted: number;
  granted_at: string | null;
  withdrawn_at: string | null;
}

export interface DeletionRequest {
  request_id: number;
  tenant_id: number;
  identifier: string | null;
  one_id: number | null;
  request_type: "delete" | "suppress" | "both";
  reason: string | null;
  status: "pending" | "processing" | "completed" | string;
  affected_tables: Record<string, number> | null;
  affected_count: number | null;
  created_by: string | null;
  created_at: string | null;
  executed_at: string | null;
}

export interface PrivacyAuditLog {
  audit_id: number;
  tenant_id: number;
  operation_type: string;
  deletion_request_id: number | null;
  operator: string | null;
  one_id: number | null;
  scope: string | null;
  affected_records: number;
  detail: Record<string, any> | null;
  created_at: string | null;
}

export interface SuppressionResult {
  suppressed: boolean;
  reason?: string;
  suppression_type?: string;
  expires_at?: string | null;
}

// ════════════════════════════════════════════════════════════════════════
// PII 扫描 / 规则
// ════════════════════════════════════════════════════════════════════════

export async function scanPii(body: {
  tenant_id: number;
  scan_depth?: "all" | "object" | "source";
  object_type?: string;
  source?: string;
  limit?: number;
}): Promise<PiiScanResult> {
  const { data } = await http.post(`/privacy/pii/scan`, body);
  return data;
}

export async function listPiiRules(
  tenant_id: number,
  object_type?: string,
): Promise<PiiRule[]> {
  const { data } = await http.get(`/privacy/pii/rules`, {
    params: { tenant_id, object_type },
  });
  return data.rules as PiiRule[];
}

export async function createPiiRule(body: {
  tenant_id: number;
  field_name: string;
  category?: string;
  action?: PiiAction;
  scope?: string;
  source?: string;
  target_objects?: string[];
  created_by?: string;
}): Promise<{ rule_id: number; created_at: string }> {
  const { data } = await http.post(`/privacy/pii/rules`, body);
  return data;
}

export async function updatePiiRule(
  tenant_id: number,
  rule_id: number,
  body: {
    action?: string;
    scope?: string;
    category?: string;
    target_objects?: string[];
    is_active?: number;
  },
): Promise<{ updated_at: string }> {
  const { data } = await http.put(`/privacy/pii/rules/${rule_id}`, body, {
    params: { tenant_id },
  });
  return data;
}

export async function deletePiiRule(
  tenant_id: number,
  rule_id: number,
  hard = false,
): Promise<{ ok: boolean }> {
  const { data } = await http.delete(`/privacy/pii/rules/${rule_id}`, {
    params: { tenant_id, hard },
  });
  return data;
}

// ════════════════════════════════════════════════════════════════════════
// 同意分类 / 记录
// ════════════════════════════════════════════════════════════════════════

export async function listConsentCategories(
  tenant_id: number,
): Promise<ConsentCategory[]> {
  const { data } = await http.get(`/privacy/consent/categories`, {
    params: { tenant_id },
  });
  return data.categories as ConsentCategory[];
}

export async function createConsentCategory(body: {
  tenant_id: number;
  category_name: string;
  description?: string;
  is_required?: boolean;
  vendor_list?: string[];
  created_by?: string;
}): Promise<{ category_id: number; created_at: string }> {
  const { data } = await http.post(`/privacy/consent/categories`, body);
  return data;
}

export async function updateConsentCategory(
  tenant_id: number,
  category_id: number,
  body: {
    category_name?: string;
    description?: string;
    is_required?: boolean;
    vendor_list?: string[];
  },
): Promise<{ updated_at: string }> {
  const { data } = await http.put(
    `/privacy/consent/categories/${category_id}`,
    body,
    { params: { tenant_id } },
  );
  return data;
}

export async function recordConsent(body: {
  tenant_id: number;
  one_id?: number;
  identifier?: string;
  category_id: number;
  granted: boolean;
}): Promise<{ record_id: number | null; created_at: string | null }> {
  const { data } = await http.post(`/privacy/consent`, body);
  return data;
}

export async function getConsent(
  tenant_id: number,
  one_id: number,
): Promise<{ one_id: number; records: ConsentRecord[] }> {
  const { data } = await http.get(`/privacy/consent/${one_id}`, {
    params: { tenant_id },
  });
  return data;
}

// ════════════════════════════════════════════════════════════════════════
// 删除 / 抑制工单
// ════════════════════════════════════════════════════════════════════════

export async function listDeletionRequests(
  tenant_id: number,
  opts: { status?: string; limit?: number; offset?: number } = {},
): Promise<{ requests: DeletionRequest[]; total: number }> {
  const { data } = await http.get(`/privacy/deletion`, {
    params: { tenant_id, ...opts },
  });
  return data;
}

export async function createDeletionRequest(body: {
  tenant_id: number;
  identifier?: string;
  one_id?: number;
  request_type?: "delete" | "suppress" | "both";
  reason?: string;
  created_by?: string;
}): Promise<{ request_id: number; status: string; created_at: string }> {
  const { data } = await http.post(`/privacy/deletion`, body);
  return data;
}

export async function executeDeletion(
  tenant_id: number,
  request_id: number,
  confirm = true,
): Promise<{
  status: string;
  affected_tables: Record<string, number>;
  executed_at: string;
  audit_id: number;
}> {
  const { data } = await http.post(
    `/privacy/deletion/${request_id}/execute`,
    { confirm },
    { params: { tenant_id } },
  );
  return data;
}

export async function getDeletionRequest(
  tenant_id: number,
  request_id: number,
): Promise<DeletionRequest & { audit_log: PrivacyAuditLog[] }> {
  const { data } = await http.get(`/privacy/deletion/${request_id}`, {
    params: { tenant_id },
  });
  return data;
}

export async function checkSuppression(
  tenant_id: number,
  opts: { identifier?: string; one_id?: number },
): Promise<SuppressionResult> {
  const { data } = await http.get(`/privacy/suppression/check`, {
    params: { tenant_id, ...opts },
  });
  return data;
}

// ════════════════════════════════════════════════════════════════════════
// 审计日志
// ════════════════════════════════════════════════════════════════════════

export async function queryAuditLogs(body: {
  tenant_id: number;
  operation_type?: string;
  request_id?: number;
  start_date?: string;
  end_date?: string;
  limit?: number;
  offset?: number;
}): Promise<{ logs: PrivacyAuditLog[]; total: number }> {
  const { data } = await http.post(`/privacy/audit/logs`, body);
  return data;
}
