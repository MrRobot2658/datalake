// 03-objects 模块 API —— 对象模型(Data Model) 管理 + 记录详情。
// 复用 client.ts 的 http 实例（baseURL=/api），不改动 client.ts 以避免并发冲突。
import { http } from "./client";

// ── 类型（与后端 OBJECT_REGISTRY / RELATION_MATRIX 对齐，字段尽量宽松以兼容后端演进）──
export type ObjectFieldType =
  | "str" | "int" | "float" | "datetime" | "json" | "json_array";

export interface ObjectFieldDef {
  code: string;
  type: string;
  label?: string;
  builtin?: boolean; // 内置字段（不可删除/改类型）
}

export interface ObjectDefinition {
  object: string;        // 对象 key，如 user/store/order
  label?: string;        // 中文名
  table?: string;
  id?: string;           // 主键字段
  id_numeric?: boolean;
  builtin?: boolean;     // 内置对象
  fields: ObjectFieldDef[];
}

export interface RelationEdgeField {
  type: string;
  label?: string;
}
export interface RelationDefinition {
  src_type: string;
  rel_type: string;
  dst_type: string;
  builtin?: boolean;
  edge_fields?: Record<string, RelationEdgeField>;
}

export interface ObjectDefinitions {
  tenant_id?: number;
  objects: ObjectDefinition[];
  relations: RelationDefinition[];
}

// 单条记录关系（一条记录视角下的出/入边）
export interface RecordRelation {
  rel_type: string;
  direction?: "forward" | "reverse";
  src_type?: string;
  src_id?: string;
  dst_type?: string;
  dst_id?: string;
  properties?: Record<string, any>;
  create_time?: string;
}

// ── 元数据 / Schema 管理 ────────────────────────────────────────────────
export async function getDefinitions(tenant: number): Promise<ObjectDefinitions> {
  const { data } = await http.get(`/objects/${tenant}/definitions`);
  return data;
}

export interface CreateObjectBody {
  tenant_id: number;
  object_key: string;
  label?: string;
  id_field: string;
  id_numeric?: boolean;
  fields?: { code: string; type: string; label?: string }[];
}
export async function createObject(body: CreateObjectBody): Promise<ObjectDefinition> {
  const { data } = await http.post(`/objects/create`, body);
  return data;
}

export interface RelationBody {
  src_type: string;
  rel_type: string;
  dst_type: string;
  edge_fields?: Record<string, RelationEdgeField>;
}
export async function createRelation(
  tenant: number,
  body: RelationBody,
): Promise<RelationDefinition> {
  const { data } = await http.post(`/objects/${tenant}/relations`, body);
  return data;
}

export async function deleteRelation(
  tenant: number,
  src_type: string,
  rel_type: string,
  dst_type: string,
): Promise<{ ok: boolean }> {
  const { data } = await http.delete(
    `/objects/${tenant}/relations/${src_type}/${rel_type}/${dst_type}`,
  );
  return data;
}

export interface AddFieldBody {
  code: string;
  type: string;
  label?: string;
}
export async function addField(
  tenant: number,
  objectKey: string,
  body: AddFieldBody,
): Promise<ObjectFieldDef> {
  const { data } = await http.post(`/objects/${tenant}/${objectKey}/fields`, body);
  return data;
}

export interface PatchFieldBody {
  type?: string;
  label?: string;
}
export async function patchField(
  tenant: number,
  objectKey: string,
  fieldCode: string,
  body: PatchFieldBody,
): Promise<ObjectFieldDef> {
  const { data } = await http.patch(
    `/objects/${tenant}/${objectKey}/fields/${fieldCode}`,
    body,
  );
  return data;
}

// ── 记录详情 ────────────────────────────────────────────────────────────
export async function getRecord(
  tenant: number,
  objectKey: string,
  pkValue: string,
): Promise<Record<string, any>> {
  const { data } = await http.get(`/objects/${tenant}/${objectKey}/${pkValue}`);
  // 兼容 {data:{...}} 或直接返回记录对象
  return (data && typeof data === "object" && data.data) ? data.data : data;
}

export async function getRecordRelations(
  tenant: number,
  objectKey: string,
  pkValue: string,
): Promise<RecordRelation[]> {
  const { data } = await http.get(
    `/objects/${tenant}/${objectKey}/${pkValue}/relations`,
  );
  const rel = Array.isArray(data) ? data : data?.relations;
  if (Array.isArray(rel)) return rel;
  // 后端按 rel_type 分组的字典：{rel_type: [{object_key,id,direction,properties,create_time}]}，展平为数组
  if (rel && typeof rel === "object") {
    const out: RecordRelation[] = [];
    for (const [rel_type, items] of Object.entries(rel as Record<string, any[]>)) {
      for (const it of items ?? []) {
        const peer = it.object_key ?? it.other_type;
        const peerId = it.id ?? it.other_id;
        const reverse = it.direction === "reverse";
        out.push({
          rel_type,
          direction: it.direction,
          ...(reverse ? { src_type: peer, src_id: peerId } : { dst_type: peer, dst_id: peerId }),
          properties: it.properties,
          create_time: it.create_time,
        });
      }
    }
    return out;
  }
  return [];
}
