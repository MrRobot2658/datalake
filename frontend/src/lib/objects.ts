import {
  Users, Tag, Boxes, Store, ShoppingCart, Package, Building2,
  type LucideIcon,
} from "lucide-react";

export type ObjectKind = "object" | "tag" | "segment" | "mock";

export interface ObjectConfig {
  key: string;            // 路由 + 后端 object key
  label: string;          // 中文名
  icon: LucideIcon;
  kind: ObjectKind;       // object=走 /objects/search；tag/segment=专用接口；mock=前端假数据
  desc: string;
  /** 列表默认展示的列（object 类，取自后端字段） */
  columns?: string[];
}

// 七大主对象（+ 标签/群组）。客户(account) 通过 owns 关系包含多个用户。
export const OBJECTS: ObjectConfig[] = [
  { key: "user", label: "用户", icon: Users, kind: "object",
    desc: "OneID 用户宽表", columns: ["one_id", "phone", "tags", "channel_count"] },
  { key: "tag", label: "用户标签", icon: Tag, kind: "tag",
    desc: "标签体系与覆盖人数" },
  { key: "segment", label: "用户群组", icon: Boxes, kind: "segment",
    desc: "已保存的人群包 / Segment" },
  { key: "store", label: "门店", icon: Store, kind: "object",
    desc: "门店主数据", columns: ["store_id", "store_name", "region", "address"] },
  { key: "order", label: "订单", icon: ShoppingCart, kind: "mock",
    desc: "订单（后端待补，当前为示例数据）" },
  { key: "product", label: "商品", icon: Package, kind: "object",
    desc: "商品主数据", columns: ["product_id", "sku", "category", "price"] },
  { key: "account", label: "客户", icon: Building2, kind: "object",
    desc: "客户（含多个用户，经 owns 关联）", columns: ["account_id", "name", "industry", "scale"] },
];

export const byKey = (k: string) => OBJECTS.find((o) => o.key === k);

export const OP_LABELS: Record<string, string> = {
  eq: "等于", ne: "不等于", gt: "大于", ge: "不小于", lt: "小于", le: "不大于",
  in: "属于", not_in: "不属于", contains: "包含", between: "介于", like: "匹配",
};

// 字段类型 → 可用操作符
export function opsForType(t: string): string[] {
  if (t === "json_array") return ["contains"];
  if (t === "int" || t === "float" || t === "datetime")
    return ["eq", "ne", "gt", "ge", "lt", "le", "between", "in", "not_in"];
  return ["eq", "ne", "like", "in", "not_in", "contains"];
}
