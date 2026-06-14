import { useCallback, useEffect, useState } from "react";
import { RefreshCw, ScrollText } from "lucide-react";
import Layout from "../components/layout/Layout";
import { Card, DataTable, Button, Spinner } from "../components/ui";
import { StatCards, StatusPill, type StatItem } from "../components/segment/kit";
import { useTenant } from "../context/TenantContext";
import {
  listDeliveryLogs,
  getDeliveryStats,
  type DeliveryLog,
  type DeliveryStat,
} from "../api/monitor";

const STATUS_FILTERS = ["", "success", "failed", "retry", "skipped"];
const STATUS_LABEL: Record<string, string> = {
  "": "全部",
  success: "成功",
  failed: "失败",
  retry: "重试",
  skipped: "跳过",
};

function statusTone(s: string): "green" | "amber" | "red" | "gray" {
  if (s === "success") return "green";
  if (s === "failed") return "red";
  if (s === "retry") return "amber";
  return "gray";
}

export default function MonitorEventLogsPage() {
  const { tenant } = useTenant();
  const [status, setStatus] = useState("");
  const [logs, setLogs] = useState<DeliveryLog[] | null>(null);
  const [stats, setStats] = useState<DeliveryStat[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    setErr(null);
    Promise.all([
      listDeliveryLogs(tenant, { status: status || undefined, limit: 200 }),
      getDeliveryStats(tenant, { group_by: "status", window_minutes: 1440 }),
    ])
      .then(([l, s]) => {
        setLogs(l);
        setStats(s);
      })
      .catch((e) => setErr(String(e)))
      .finally(() => setLoading(false));
  }, [tenant, status]);

  useEffect(() => {
    load();
  }, [load]);

  const statItems: StatItem[] = (stats || []).map((s) => ({
    label: STATUS_LABEL[s.dimension || ""] || s.dimension || "—",
    value: s.cnt.toLocaleString(),
    sub: s.avg_latency != null ? `平均 ${Math.round(s.avg_latency)}ms` : undefined,
    tone: statusTone(s.dimension || ""),
  }));

  return (
    <Layout
      title="事件日志 Event Logs"
      subtitle="实时事件投递日志，逐条追踪数据源到目的地的处理结果（来自 /monitor/delivery-logs · /delivery-stats）"
      actions={
        <Button variant="outline" onClick={load} disabled={loading}>
          {loading ? <Spinner /> : <RefreshCw className="h-4 w-4" />} 刷新
        </Button>
      }
    >
      {err && <Card className="mb-4 p-4 text-sm text-red-600">{err}</Card>}

      {stats && statItems.length > 0 && <StatCards items={statItems.slice(0, 4)} />}

      <div className="mb-4 flex flex-wrap gap-1">
        {STATUS_FILTERS.map((s) => (
          <button
            key={s || "all"}
            onClick={() => setStatus(s)}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
              status === s
                ? "bg-brand-500 text-white"
                : "border border-gray-300 text-gray-600 hover:bg-gray-50"
            }`}
          >
            {STATUS_LABEL[s]}
          </button>
        ))}
      </div>

      <Card className="p-2">
        <div className="flex items-center gap-2 px-3 pt-3 text-sm font-semibold text-gray-900">
          <ScrollText className="h-4 w-4 text-brand-500" /> 投递日志
        </div>
        {!logs ? (
          <div className="flex items-center gap-2 px-3 py-6 text-gray-500">
            <Spinner /> 加载中…
          </div>
        ) : (
          <DataTable
            columns={["时间", "数据源", "事件", "目的地", "状态", "HTTP", "时延", "错误"]}
            rows={logs.map((e) => ({
              "时间": e.ts,
              "数据源": e.source,
              "事件": e.event_name || "—",
              "目的地": e.destination || "—",
              "状态": <StatusPill tone={statusTone(e.status)}>{STATUS_LABEL[e.status] || e.status}</StatusPill>,
              "HTTP": e.http_code ?? "—",
              "时延": e.latency_ms != null ? `${e.latency_ms}ms` : "—",
              "错误": e.error_message || "—",
            }))}
          />
        )}
      </Card>
    </Layout>
  );
}
