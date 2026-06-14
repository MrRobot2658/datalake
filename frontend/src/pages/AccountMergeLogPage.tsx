import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import Layout from "../components/layout/Layout";
import { Card, DataTable, Spinner, Badge } from "../components/ui";
import { listAllMergeLog, type MergeLogEntry } from "../api/accounts";
import { useTenant } from "../context/TenantContext";

// 客户合并日志（租户全量）—— 读 /accounts/-/merge-log
const ACTION: Record<string, string> = { merge: "合并", dedup: "去重", unmerge: "拆分" };

export default function AccountMergeLogPage() {
  const { tenant } = useTenant();
  const [rows, setRows] = useState<MergeLogEntry[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setRows(null); setErr(null);
    listAllMergeLog(tenant, 200)
      .then(setRows)
      .catch((e) => setErr(String(e)));
  }, [tenant]);

  const view = (rows || []).map((m) => ({
    动作: ACTION[m.action] ?? m.action,
    主账户: m.master_account_id,
    被合并账户: m.merged_account_id,
    用户数: m.user_count ?? "—",
    操作人: m.created_by ?? "—",
    时间: m.created_at ?? "—",
    _id: m.master_account_id,
  }));

  return (
    <Layout
      title="客户合并日志"
      subtitle="Account Merge Log · 租户全量账户合并 / 去重 / 拆分审计"
      actions={
        <div className="flex items-center gap-3">
          {rows && <Badge color="brand">{rows.length} 条</Badge>}
          <Link to="/accounts" className="inline-flex items-center gap-1 text-sm font-medium text-brand-600">
            <ArrowLeft className="h-4 w-4" /> 返回客户列表
          </Link>
        </div>
      }
    >
      {err && <Card className="p-5 text-sm text-red-600">{err}</Card>}
      {!rows && !err && <div className="flex items-center gap-2 text-gray-500"><Spinner /> 加载中…</div>}
      {rows && (
        <Card className="p-2">
          <DataTable
            columns={["动作", "主账户", "被合并账户", "用户数", "操作人", "时间"]}
            rows={view}
            rowLink={(r) => `/accounts/${r._id}`}
          />
        </Card>
      )}
    </Layout>
  );
}
