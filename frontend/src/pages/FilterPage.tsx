import Layout from "../components/layout/Layout";
import UnifiedFilter from "../components/filter/UnifiedFilter";

export default function FilterPage() {
  return (
    <Layout title="统一筛选器">
      <p className="mb-5 text-sm text-gray-500">
        多条件 / 多条线 / 跨对象链式关联 + 边条件，支持自然语言；实时预估人数与 SQL 预览。
      </p>
      <UnifiedFilter />
    </Layout>
  );
}
