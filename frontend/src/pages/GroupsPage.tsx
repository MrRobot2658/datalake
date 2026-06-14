import { useEffect, useState, useCallback } from "react";
import { Boxes, RefreshCw } from "lucide-react";
import Layout from "../components/layout/Layout";
import { Card, DataTable, Spinner, Button } from "../components/ui";
import { StatCards, StatusPill } from "../components/segment/kit";
import { useTenant } from "../context/TenantContext";
import { byKey } from "../lib/objects";
import { listGroups, refreshGroup, type UnifyGroup } from "../api/unify";

type Filter = "all" | "static" | "dynamic";

export default function GroupsPage() {
  const { tenant } = useTenant();
  const [groups, setGroups] = useState<UnifyGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [refreshing, setRefreshing] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      setGroups(await listGroups(tenant, filter === "all" ? undefined : filter));
    } catch (e: any) {
      setError(e?.response?.data?.detail || e.message || "加载失败");
    } finally {
      setLoading(false);
    }
  }, [tenant, filter]);

  useEffect(() => { load(); }, [load]);

  async function refresh(groupId: number) {
    setRefreshing(groupId); setError(null); setMsg(null);
    try {
      const r = await refreshGroup(tenant, groupId);
      setMsg(`群组 ${groupId} 刷新完成：命中 ${r.matched}，当前成员 ${r.member_count}`);
      await load();
    } catch (e: any) {
      setError(e?.response?.data?.detail || e.message || "刷新失败");
    } finally {
      setRefreshing(null);
    }
  }

  const dynamicCount = groups.filter((g) => g.group_type === "dynamic").length;
  const totalMembers = groups.reduce((a, g) => a + (g.member_count || 0), 0);

  return (
    <Layout
      title="群组 Groups"
      subtitle="对象的集合（人群包）—— 静态名单 / 动态规则，成员可为任意对象类型"
    >
      {error && <div className="mb-4 rounded-lg bg-red-50 px-4 py-2 text-sm text-red-600">{error}</div>}
      {msg && <div className="mb-4 rounded-lg bg-brand-50 px-4 py-2 text-sm text-brand-700">{msg}</div>}

      <StatCards items={[
        { label: "群组数", value: groups.length },
        { label: "动态群组", value: dynamicCount },
        { label: "静态群组", value: groups.length - dynamicCount },
        { label: "成员合计", value: totalMembers },
      ]} />

      <div className="mb-4 flex gap-1">
        {([["all", "全部"], ["dynamic", "动态"], ["static", "静态"]] as [Filter, string][]).map(([k, label]) => (
          <button key={k} onClick={() => setFilter(k)}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium ${filter === k ? "bg-brand-50 text-brand-700" : "text-gray-500 hover:bg-gray-100"}`}>
            {label}
          </button>
        ))}
      </div>

      <Card className="p-2">
        {loading ? (
          <div className="flex justify-center py-12"><Spinner /></div>
        ) : (
          <DataTable
            columns={["群组", "类型", "成员对象", "成员数", "更新时间", ""]}
            rows={groups.map((g) => ({
              "群组": g.group_name || `群组 ${g.group_id}`,
              "类型": <StatusPill tone={g.group_type === "dynamic" ? "blue" : "gray"}>
                {g.group_type === "dynamic" ? "动态" : "静态"}
              </StatusPill>,
              "成员对象": byKey(g.member_object_type || "user")?.label || g.member_object_type || "用户",
              "成员数": g.member_count ?? 0,
              "更新时间": g.updated_at ?? "—",
              "": g.group_type === "dynamic" ? (
                <button onClick={(e) => { e.stopPropagation(); refresh(g.group_id); }}
                  disabled={refreshing === g.group_id}
                  className="inline-flex items-center gap-1 text-sm font-medium text-brand-600 hover:text-brand-700 disabled:opacity-50">
                  <RefreshCw className="h-3.5 w-3.5" /> {refreshing === g.group_id ? "刷新中" : "刷新成员"}
                </button>
              ) : <span className="text-gray-300">—</span>,
            }))}
          />
        )}
        {!loading && groups.length === 0 && (
          <div className="flex flex-col items-center gap-2 px-6 py-12 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-brand-50 text-brand-600">
              <Boxes className="h-6 w-6" />
            </div>
            <div className="font-semibold text-gray-900">暂无群组</div>
            <div className="max-w-sm text-sm text-gray-500">
              在「受众」中基于筛选「存为群组」，或导入静态名单后在此管理与刷新。
            </div>
            <Button className="mt-2" variant="outline" onClick={load}>
              <RefreshCw className="h-4 w-4" /> 刷新列表
            </Button>
          </div>
        )}
      </Card>
    </Layout>
  );
}
