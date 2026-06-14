import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, Users } from "lucide-react";
import Layout from "../components/layout/Layout";
import { Card, DataTable, Spinner, Badge } from "../components/ui";
import { StatCards } from "../components/segment/kit";
import { searchObjects } from "../api/client";
import { useTenant } from "../context/TenantContext";

const SCALE: Record<string, string> = { large: "大型", medium: "中型", small: "小型" };

export default function AccountDetailPage() {
  const { id = "" } = useParams();
  const { tenant } = useTenant();
  const [account, setAccount] = useState<Record<string, any> | null>(null);
  const [users, setUsers] = useState<Record<string, any>[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setAccount(null); setUsers(null); setErr(null);
    // 客户基本信息
    searchObjects({ tenant_id: tenant, object: "account", limit: 1, conditions: [{ field: "account_id", op: "eq", value: id }] })
      .then((r) => setAccount(r.data?.[0] || {}))
      .catch((e) => setErr(String(e)));
    // 该客户下的用户：user --owns--> account(account_id=id)
    searchObjects({
      tenant_id: tenant, object: "user", limit: 200,
      relations: [{ rel_type: "owns", object: "account", direction: "forward", conditions: [{ field: "account_id", op: "eq", value: id }] }],
    })
      .then((r) => setUsers(r.data || []))
      .catch((e) => setErr(String(e)));
  }, [id, tenant]);

  const userView = (users || []).map((u) => ({
    OneID: u.one_id,
    手机号: u.phone,
    标签: Array.isArray(u.tags) ? u.tags.join(", ") : u.tags,
    渠道数: u.channel_count,
    _id: u.one_id,
  }));

  return (
    <Layout
      title={`${account?.name ?? id} · 客户详情`}
      subtitle={`客户 Account · ${id}`}
      actions={<Link to="/accounts" className="inline-flex items-center gap-1 text-sm font-medium text-brand-600"><ArrowLeft className="h-4 w-4" /> 返回客户列表</Link>}
    >
      {err && <Card className="mb-4 p-5 text-sm text-red-600">{err}</Card>}
      {!account && !err && <div className="flex items-center gap-2 text-gray-500"><Spinner /> 加载中…</div>}

      {account && (
        <>
          <StatCards items={[
            { label: "客户ID", value: account.account_id ?? id },
            { label: "行业", value: account.industry ?? "—" },
            { label: "规模", value: SCALE[account.scale] ?? account.scale ?? "—" },
            { label: "关联用户", value: users ? users.length : "…" },
          ]} />

          <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-700">
            <Users className="h-4 w-4 text-brand-500" /> 该客户下的用户 Users
            {users && <Badge color="brand">{users.length}</Badge>}
            <span className="font-normal text-gray-400">· 点击行查看用户档案</span>
          </div>
          <Card className="p-2">
            {!users ? (
              <div className="flex items-center gap-2 px-4 py-6 text-gray-500"><Spinner /> 加载用户…</div>
            ) : (
              <DataTable
                columns={["OneID", "手机号", "标签", "渠道数"]}
                rows={userView}
                rowLink={(r) => `/unify/profiles/${r._id}`}
              />
            )}
          </Card>
        </>
      )}
    </Layout>
  );
}
