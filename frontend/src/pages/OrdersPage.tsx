import Layout from "../components/layout/Layout";
import { Card, DataTable, Badge } from "../components/ui";

// 订单后端对象暂未接入（OBJECT_REGISTRY 当前为 user/lead/account/product/store）。
// 这里用示例数据跑通 UI；后端补 order 对象 + purchased 边后切真实接口即可。
const MOCK_ORDERS = [
  { order_id: "O90001", account_id: "A3001", product_id: "P4001", amount: 1299, channel: "app", create_time: "2026-06-13 03:07" },
  { order_id: "O90002", account_id: "A3001", product_id: "P4002", amount: 459, channel: "web", create_time: "2026-06-12 21:40" },
  { order_id: "O90003", account_id: "A3002", product_id: "P4003", amount: 88, channel: "store", create_time: "2026-05-30 10:12" },
];

export default function OrdersPage() {
  return (
    <Layout title="订单">
      <div className="mb-5 flex items-center gap-2">
        <p className="text-sm text-gray-500">订单（后端对象待补）</p>
        <Badge color="amber">示例数据</Badge>
      </div>
      <Card className="mb-4 p-4 text-sm text-amber-700">
        当前订单为前端示例数据。后端补 <code className="rounded bg-amber-100 px-1">order</code> 对象与
        <code className="rounded bg-amber-100 px-1">purchased</code> 边后，本页切换到 /objects/search 即可参与统一筛选。
      </Card>
      <Card className="p-2">
        <DataTable columns={Object.keys(MOCK_ORDERS[0])} rows={MOCK_ORDERS} />
      </Card>
    </Layout>
  );
}
