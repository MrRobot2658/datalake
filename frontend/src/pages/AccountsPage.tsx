import { useEffect, useState } from "react";
import Layout from "../components/layout/Layout";
import { Card, DataTable, Spinner, Badge } from "../components/ui";
import { searchObjects } from "../api/client";
import { useTenant } from "../context/TenantContext";

// 客户管理 —— 客户(account)列表，一个客户可含多个用户。点击行进入客户详情。
const SCALE: Record<string, string> = { large: "大型", medium: "中型", small: "小型" };

export default function AccountsPage() {
  const { tenant } = useTenant();
  const [rows, setRows] = useState<Record<string, any>[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setRows(null); setErr(null);
    searchObjects({ tenant_id: tenant, object: "account", limit: 200 })
      .then((r) => setRows(r.data || []))
      .catch((e) => setErr(String(e)));
  }, [tenant]);

  const view = (rows || []).map((r) => ({
    客户ID: r.account_id,
    名称: r.name,
    行业: r.industry,
    规模: SCALE[r.scale] ?? r.scale,
    _id: r.account_id,
  }));

  return (
    <Layout
      title="客户 Accounts"
      subtitle="客户（账户）主数据 —— 一个客户可关联多个用户；点击客户查看其用户"
      actions={rows ? <Badge color="brand">{rows.length} 个客户</Badge> : undefined}
    >
      {err && <Card className="p-5 text-sm text-red-600">{err}</Card>}
      {!rows && !err && <div className="flex items-center gap-2 text-gray-500"><Spinner /> 加载中…</div>}
      {rows && (
        <Card className="p-2">
          <div className="px-3 pb-2 pt-3 text-sm font-semibold text-gray-700">
            客户列表 <span className="ml-2 font-normal text-gray-400">· 点击行查看详情</span>
          </div>
          <DataTable
            columns={["客户ID", "名称", "行业", "规模"]}
            rows={view}
            rowLink={(r) => `/accounts/${r._id}`}
          />
        </Card>
      )}
    </Layout>
  );
}
