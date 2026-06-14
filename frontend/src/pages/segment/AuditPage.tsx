import { useCallback, useEffect, useState } from "react";
import { Search } from "lucide-react";
import Layout from "../../components/layout/Layout";
import { Button, Card, DataTable, Spinner } from "../../components/ui";
import { SubTabs } from "../../components/segment/kit";
import { useTenant } from "../../context/TenantContext";
import { listAudit, type AuditEntry } from "../../api/settings";

const TABS = [
  { label: "通用", to: "/settings" },
  { label: "权限管理", to: "/settings/access" },
  { label: "API 令牌", to: "/settings/tokens" },
  { label: "审计日志", to: "/settings/audit" },
];

export default function AuditPage() {
  const { tenant } = useTenant();
  const [rows, setRows] = useState<AuditEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [actor, setActor] = useState("");
  const [action, setAction] = useState("");
  const [target, setTarget] = useState("");

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const r = await listAudit({
        tenant_id: tenant,
        actor: actor || undefined,
        action: action || undefined,
        target: target || undefined,
        limit: 200,
      });
      setRows(r.data);
      setTotal(r.total);
    } catch (e: any) {
      setError(e?.response?.data?.detail || e.message || "加载失败");
    } finally {
      setLoading(false);
    }
  }, [tenant, actor, action, target]);

  // 租户切换即重查；筛选走按钮/回车
  useEffect(() => { load(); }, [tenant]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Layout
      title="审计日志 Audit Trail"
      subtitle={`工作区内的关键操作记录 · 共 ${total} 条`}
    >
      <SubTabs tabs={TABS.map((t) => ({ ...t, active: t.label === "审计日志" }))} />

      <Card className="mb-4 p-4">
        <div className="flex flex-wrap items-end gap-3">
          <Field label="操作者 actor" value={actor} onChange={setActor} onEnter={load} placeholder="如 system" />
          <Field label="动作 action" value={action} onChange={setAction} onEnter={load} placeholder="如 issue_token" />
          <Field label="对象 target" value={target} onChange={setTarget} onEnter={load} placeholder="模糊匹配" />
          <Button variant="outline" onClick={load}><Search className="h-4 w-4" /> 查询</Button>
        </div>
      </Card>

      {error && <div className="mb-4 rounded-lg bg-red-50 px-4 py-2 text-sm text-red-600">{error}</div>}

      <Card className="p-2">
        {loading ? (
          <div className="flex justify-center py-12"><Spinner /></div>
        ) : (
          <DataTable
            columns={["时间", "操作者", "动作", "对象", "模块", "详情"]}
            rows={rows.map((a) => ({
              时间: a.time,
              操作者: a.actor,
              动作: a.action,
              对象: a.target,
              模块: a.module,
              详情: a.details && Object.keys(a.details).length
                ? <span className="text-xs text-gray-500">{JSON.stringify(a.details)}</span>
                : "—",
            }))}
          />
        )}
        {!loading && rows.length === 0 && (
          <div className="px-6 py-12 text-center text-sm text-gray-500">无审计记录</div>
        )}
      </Card>
    </Layout>
  );
}

function Field({
  label, value, onChange, onEnter, placeholder,
}: { label: string; value: string; onChange: (v: string) => void; onEnter: () => void; placeholder?: string }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-gray-700">{label}</span>
      <input
        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-400 focus:outline-none"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && onEnter()}
      />
    </label>
  );
}
