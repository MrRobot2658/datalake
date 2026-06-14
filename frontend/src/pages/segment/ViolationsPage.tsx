import { useEffect, useState } from "react";
import { Trash2, AlertTriangle } from "lucide-react";
import Layout from "../../components/layout/Layout";
import { Card, Spinner } from "../../components/ui";
import { StatCards, StatusPill, EmptyState } from "../../components/segment/kit";
import { useTenant } from "../../context/TenantContext";
import { listViolations, deleteViolation, type Violation } from "../../api/protocols";

export default function ViolationsPage() {
  const { tenant } = useTenant();
  const [rows, setRows] = useState<Violation[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [severity, setSeverity] = useState<string>("");

  function load() {
    setRows(null); setErr(null);
    listViolations(tenant, severity ? { severity } : undefined)
      .then(setRows).catch((e) => setErr(String(e)));
  }
  useEffect(load, [tenant, severity]);

  async function remove(v: Violation) {
    if (!confirm(`删除违规记录「${v.event} · ${v.issue}」？`)) return;
    try { await deleteViolation(tenant, v.id); load(); }
    catch (e) { setErr(String(e)); }
  }

  const totalCount = rows?.reduce((a, v) => a + v.count, 0) ?? 0;
  const high = rows?.filter((v) => v.severity === "high").length ?? 0;

  return (
    <Layout
      title="数据质量违规 Violations"
      subtitle="上报与埋点计划不符的事件，及时发现并修复数据质量问题（来自 /protocols/violations）"
      actions={
        <select className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-400 focus:outline-none"
          value={severity} onChange={(e) => setSeverity(e.target.value)}>
          <option value="">全部级别</option>
          <option value="high">仅高危</option>
          <option value="low">仅低危</option>
        </select>
      }
    >
      <StatCards items={[
        { label: "违规类型", value: rows?.length ?? "—" },
        { label: "受影响事件次数", value: totalCount.toLocaleString() },
        { label: "高危", value: high },
      ]} />

      {err && <Card className="mb-4 p-4 text-sm text-red-600">{err}</Card>}
      {!rows && !err && <div className="flex items-center gap-2 text-gray-500"><Spinner /> 加载中…</div>}

      {rows && rows.length === 0 && (
        <EmptyState
          icon={AlertTriangle}
          title="暂无违规记录"
          desc="当上报事件不符合埋点计划 schema 时，会在此处出现。"
        />
      )}

      {rows && rows.length > 0 && (
        <Card className="p-2">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wider text-gray-400">
                <th className="px-4 py-3 font-semibold">事件</th>
                <th className="px-4 py-3 font-semibold">问题</th>
                <th className="px-4 py-3 font-semibold">出现次数</th>
                <th className="px-4 py-3 font-semibold">数据源</th>
                <th className="px-4 py-3 font-semibold">级别</th>
                <th className="px-4 py-3 font-semibold">最近</th>
                <th className="px-4 py-3 font-semibold">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.map((v) => (
                <tr key={v.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium text-gray-900">{v.event}</td>
                  <td className="px-4 py-3 text-gray-700">{v.issue}</td>
                  <td className="px-4 py-3 text-gray-700">{v.count.toLocaleString()}</td>
                  <td className="px-4 py-3 text-gray-500">{v.source || "—"}</td>
                  <td className="px-4 py-3">
                    {v.severity === "high"
                      ? <StatusPill tone="red">高</StatusPill>
                      : <StatusPill tone="gray">低</StatusPill>}
                  </td>
                  <td className="px-4 py-3 text-gray-400">{v.last_seen ? String(v.last_seen).slice(0, 19).replace("T", " ") : "—"}</td>
                  <td className="px-4 py-3">
                    <button className="text-gray-400 hover:text-red-600" onClick={() => remove(v)} title="删除">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </Layout>
  );
}
