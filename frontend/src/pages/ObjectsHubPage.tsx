import Layout from "../components/layout/Layout";
import { Catalog, type CatalogItem } from "../components/segment/kit";
import { byKey } from "../lib/objects";

// 对象管理 —— 门店 / 产品 / 订单（真实数据，点击进入各对象列表）
const KEYS = ["store", "product", "order"];

export default function ObjectsHubPage() {
  const items: CatalogItem[] = KEYS.map((k) => {
    const o = byKey(k)!;
    return {
      icon: o.icon,
      name: o.label,
      term: o.key,
      desc: o.desc,
      to: `/objects/${o.key}`,
      status: { tone: "green" as const, label: "真实数据" },
    };
  });

  return (
    <Layout
      title="对象 Objects"
      subtitle="门店 / 产品 / 订单等主对象 —— 点击进入对象列表，支持统一筛选器全部能力"
    >
      <Catalog items={items} />
    </Layout>
  );
}
