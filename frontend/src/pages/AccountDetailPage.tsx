import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, Users, Building2, GitMerge } from "lucide-react";
import Layout from "../components/layout/Layout";
import { Card, DataTable, Spinner, Badge } from "../components/ui";
import { StatCards } from "../components/segment/kit";
import {
  getAccount,
  listAccountUsers,
  listAccountMergeLog,
  type AccountDetail,
  type MergeLogEntry,
} from "../api/accounts";
import { useTenant } from "../context/TenantContext";

const SCALE: Record<string, string> = { large: "大型", medium: "中型", small: "小型" };
const ACTION: Record<string, string> = { merge: "合并", dedup: "去重", unmerge: "拆分" };

function gmv(v: any) {
  const n = Number(v);
  return Number.isFinite(n) ? `¥${n.toLocaleString()}` : "—";
}

export default function AccountDetailPage() {
  const { id = "" } = useParams();
  const { tenant } = useTenant();
  const [detail, setDetail] = useState<AccountDetail | null>(null);
  const [users, setUsers] = useState<Record<string, any>[] | null>(null);
  const [mergeLog, setMergeLog] = useState<MergeLogEntry[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setDetail(null); setUsers(null); setMergeLog(null); setErr(null);
    getAccount(tenant, id)
      .then(setDetail)
      .catch((e) => setErr(String(e?.response?.data?.detail || e)));
    listAccountUsers(tenant, id, 200)
      .then((r) => setUsers(r.data || []))
      .catch(() => setUsers([]));
    listAccountMergeLog(tenant, id, 50)
      .then(setMergeLog)
      .catch(() => setMergeLog([]));
  }, [id, tenant]);

  const account = detail?.account;
  const agg = detail?.aggregates;
  const hierarchy = detail?.hierarchy;

  const userView = (users || []).map((u) => ({
    OneID: u.one_id,
    手机号: u.phone,
    标签: Array.isArray(u.tags) ? u.tags.join(", ") : u.tags,
    渠道数: u.channel_count,
    _id: u.one_id,
  }));

  const childView = (hierarchy?.children || []).map((c) => ({
    子账户ID: c.account_id,
    层级: c.level,
    关系: c.relationship_type ?? "—",
    _id: c.account_id,
  }));

  const mergeView = (mergeLog || []).map((m) => ({
    动作: ACTION[m.action] ?? m.action,
    主账户: m.master_account_id,
    被合并账户: m.merged_account_id,
    用户数: m.user_count ?? "—",
    操作人: m.created_by ?? "—",
    时间: m.created_at ?? "—",
  }));

  return (
    <Layout
      title={`${account?.name ?? id} · 客户详情`}
      subtitle={`客户 Account · ${id}`}
      actions={<Link to="/accounts" className="inline-flex items-center gap-1 text-sm font-medium text-brand-600"><ArrowLeft className="h-4 w-4" /> 返回客户列表</Link>}
    >
      {err && <Card className="mb-4 p-5 text-sm text-red-600">{err}</Card>}
      {!detail && !err && <div className="flex items-center gap-2 text-gray-500"><Spinner /> 加载中…</div>}

      {account && (
        <>
          <StatCards items={[
            { label: "行业", value: account.industry ?? "—" },
            { label: "规模", value: SCALE[account.scale ?? ""] ?? account.scale ?? "—" },
            { label: "关联用户", value: agg?.user_count ?? (users ? users.length : "…") },
            { label: "累计 GMV", value: agg ? gmv(agg.total_gmv) : "—" },
          ]} />

          {/* 账户级聚合指标 */}
          <div className="mb-3 text-sm font-semibold text-gray-700">账户聚合指标 Aggregates</div>
          <Card className="mb-6 p-5">
            {agg ? (
              <div className="grid grid-cols-2 gap-4 text-sm md:grid-cols-3 lg:grid-cols-6">
                <Metric label="用户数" value={agg.user_count} />
                <Metric label="活跃用户" value={agg.active_user_count} />
                <Metric label="累计 GMV" value={gmv(agg.total_gmv)} />
                <Metric label="购买次数" value={agg.purchase_count} />
                <Metric label="产品数" value={agg.product_count} />
                <Metric label="渠道数" value={agg.channel_count} />
                {Array.isArray(agg.tags) && agg.tags.length > 0 && (
                  <div className="col-span-2 md:col-span-3 lg:col-span-6">
                    <div className="text-xs font-medium uppercase tracking-wide text-gray-400">标签</div>
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      {agg.tags.map((t) => <Badge key={t} color="brand">{t}</Badge>)}
                    </div>
                  </div>
                )}
                {agg.last_update_time && (
                  <div className="col-span-2 text-xs text-gray-400 md:col-span-3 lg:col-span-6">
                    更新时间：{agg.last_update_time}{agg.metric_date ? ` · 指标日期 ${agg.metric_date}` : ""}
                  </div>
                )}
              </div>
            ) : (
              <div className="text-sm text-gray-400">暂无聚合指标</div>
            )}
          </Card>

          {/* 账户层级 */}
          <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-700">
            <Building2 className="h-4 w-4 text-brand-500" /> 账户层级 Hierarchy
            {hierarchy?.node?.parent_account_id && (
              <span className="font-normal text-gray-400">
                · 上级 <Link className="text-brand-600" to={`/accounts/${hierarchy.node.parent_account_id}`}>{hierarchy.node.parent_account_id}</Link>
              </span>
            )}
          </div>
          <Card className="mb-6 p-2">
            {childView.length > 0 ? (
              <DataTable
                columns={["子账户ID", "层级", "关系"]}
                rows={childView}
                rowLink={(r) => `/accounts/${r._id}`}
              />
            ) : (
              <div className="px-4 py-6 text-sm text-gray-400">无下级账户</div>
            )}
          </Card>

          {/* 该客户下的用户 */}
          <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-700">
            <Users className="h-4 w-4 text-brand-500" /> 该客户下的用户 Users
            {users && <Badge color="brand">{users.length}</Badge>}
            <span className="font-normal text-gray-400">· 点击行查看用户档案</span>
          </div>
          <Card className="mb-6 p-2">
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

          {/* 账户合并日志 */}
          <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-700">
            <GitMerge className="h-4 w-4 text-brand-500" /> 合并日志 Merge Log
            {mergeLog && <Badge color="brand">{mergeLog.length}</Badge>}
          </div>
          <Card className="p-2">
            {!mergeLog ? (
              <div className="flex items-center gap-2 px-4 py-6 text-gray-500"><Spinner /> 加载日志…</div>
            ) : (
              <DataTable
                columns={["动作", "主账户", "被合并账户", "用户数", "操作人", "时间"]}
                rows={mergeView}
              />
            )}
          </Card>
        </>
      )}
    </Layout>
  );
}

function Metric({ label, value }: { label: string; value: any }) {
  return (
    <div>
      <div className="text-xs font-medium uppercase tracking-wide text-gray-400">{label}</div>
      <div className="mt-0.5 text-lg font-semibold text-gray-900">{value ?? "—"}</div>
    </div>
  );
}
