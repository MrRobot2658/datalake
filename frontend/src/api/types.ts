// 与 sql-engine DSL 对齐的类型

export type Op =
  | "eq" | "ne" | "gt" | "ge" | "lt" | "le"
  | "in" | "not_in" | "contains" | "between" | "like";

export interface Leaf {
  field: string;
  op: Op;
  value: any;
}

/** 边条件：作用在关系行上（create_time / properties.<key>） */
export interface EdgeLeaf {
  field: string;
  op: Op;
  value: any;
}

export interface Relation {
  rel_type: string;
  object: string;
  direction?: "forward" | "reverse";
  logic?: "AND" | "OR";
  conditions?: Leaf[];
  edge_conditions?: EdgeLeaf[];
  relations?: Relation[]; // 链式多跳
}

export interface DslRule {
  object: string;
  logic?: "AND" | "OR";
  conditions: Leaf[];
  relations: Relation[];
}

export interface FieldDef {
  code: string;
  type: string;
}
export interface ObjectMeta {
  object: string;
  table: string;
  id: string;
  fields: FieldDef[];
}
export interface EdgeFieldSpec {
  type: string;
  label?: string;
}
export interface RelationMeta {
  src_type: string;
  rel_type: string;
  dst_type: string;
  edge_fields?: Record<string, EdgeFieldSpec>;
}
export interface Metadata {
  tenant_id: number;
  objects: ObjectMeta[];
  relations: RelationMeta[];
}

export interface SearchResult {
  object: string;
  row_count?: number;
  estimate?: number;
  elapsed_ms: number;
  sql: string;
  data?: Record<string, any>[];
}

export interface DraftResult {
  trace_id: string;
  question: string;
  source: string;
  needs_clarification: boolean;
  clarifications: string[];
  rule: DslRule | null;
  summary: string | null;
  estimate: number | null;
  estimate_ms: number | null;
  confidence: number;
  reason: string;
}
