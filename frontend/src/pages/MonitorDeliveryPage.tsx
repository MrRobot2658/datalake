import { useCallback, useEffect, useState } from "react";
import { RefreshCw, Activity } from "lucide-react";
import Layout from "../components/layout/Layout";
import { Card, DataTable, Button, Spinner } from "../components/ui";
import { StatCards, Sparkline, StatusPill } from "../components/segment/kit";
import { useTenant } from "../context/TenantContext";
import {
  getOverview,
  listMetrics,
  listSources,
  type MonitorOverview,
  type MetricBucket,
  type SourceHealth,
} from "../api/monitor";

// 窗口预设（分钟）
const WINDOWS: { label: string; minutes: number }[] = [
  { label: "近 1 小时", minutes: 60 },
  { label: "近 6 小时", minutes: 360 },
  { label: "近 24 小时", minutes: 1440 },
  { label: "近 7 天", minutes: 10080 },
];

function sourceTone(rate: number | null): "green" | "amber" | "red" | "gray" {
  if (rate == null) return "gray";
  if (rate >= 99) return "green";
  if (rate >= 90) return "amber";
  return "red";
}

export default function MonitorDeliveryPage() {
  const { tenant } = useTenant();
  const [windowMin, setWindowMin] = useState(60);
  const [ov, setOv] = useState<MonitorOverview | null>(null);
  const [metrics, setMetrics] = useState<MetricBucket[] | null>(null);
  const [sources, setSources] = useState<SourceHealth[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    setErr(null);
    Promise.all([
      getOverview(tenant, { window_minutes: windowMin }),
      listMetrics(tenant, { limit: 200 }),
      listSources(tenant),
    ])
      .then(([o, m, s]) => {
        setOv(o);
        setMetrics(m);
        setSources(s);
      })
      .catch((e) => setErr(String(e)))
      .finally(() => setLoading(false));
  }, [tenant, windowMin]);

  useEffect(() => {
    load();
  }, [load]);

  // 折线：按桶聚合事件量（同桶不同 source 求和）
  const series = (() => {
    if (!metrics) return [];
    const byBucket = new Map<string, number>();
    for (const m of metrics) {
      byBucket.set(m.bucket_ts, (byBucket.get(m.bucket_ts) || 0) + (m.events_total || 0));
    }
    return [...byBucket.entries()]
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([, v]) => v);
  })();

  return (
    <Layout
      title="投递概览 Delivery Overview"
      subtitle="实时监控事件投递吞吐、成功率与各数据源健康度（来自 /monitor/overview · /metrics · /sources）"
      actions={
        <Button variant="outline" onClick={load} disabled={loading}>
          {loading ? <Spinner /> : <RefreshCw className="h-4 w-4" />} 刷新
        </Button>
      }
    >
      {err && <Card className="mb-4 p-4 text-sm text-red-600">{err}</Card>}

      <div className="mb-4 flex flex-wrap gap-1">
        {WINDOWS.map((w) => (
          <button
            key={w.minutes}
            onClick={() => setWindowMin(w.minutes)}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
              windowMin === w.minutes
                ? "bg-brand-500 text-white"
                : "border border-gray-300 text-gray-600 hover:bg-gray-50"
            }`}
          >
            {w.label}
          </button>
        ))}
      </div>

      <StatCards
        items={[
          { label: "事件总数", value: ov ? ov.events_total.toLocaleString() : "…" },
          {
            label: "成功率",
            value: ov ? (ov.success_rate != null ? `${ov.success_rate}%` : "—") : "…",
            tone: ov && ov.success_rate != null ? sourceTone(ov.success_rate) : "gray",
          },
          { label: "失败数", value: ov ? ov.failed_count.toLocaleString() : "…" },
          {
            label: "平均 P95 时延",
            value: ov ? (ov.avg_latency_p95 != null ? `${Math.round(ov.avg_latency_p95)}ms` : "—") : "…",
          },
        ]}
      />

      <Card className="mb-6 p-5">
        <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-900">
          <Activity className="h-4 w-4 text-brand-500" /> 事件量趋势
        </div>
        {!metrics ? (
          <div className="flex items-center gap-2 text-gray-500">
            <Spinner /> 加载中…
          </div>
        ) : series.length ? (
          <Sparkline data={series} height={80} />
        ) : (
          <div className="py-6 text-center text-sm text-gray-400">暂无指标数据</div>
        )}
      </Card>

      <Card className="p-2">
        <div className="px-3 pt-3 text-sm font-semibold text-gray-900">数据源健康</div>
        {!sources ? (
          <div className="flex items-center gap-2 px-3 py-6 text-gray-500">
            <Spinner /> 加载中…
          </div>
        ) : (
          <DataTable
            columns={["数据源", "事件总数", "成功", "失败", "成功率", "最近上报", "状态"]}
            rows={sources.map((s) => ({
              "数据源": s.source || "—",
              "事件总数": s.events_total.toLocaleString(),
              "成功": s.success_count.toLocaleString(),
              "失败": s.failed_count.toLocaleString(),
              "成功率": s.success_rate != null ? `${s.success_rate}%` : "—",
              "最近上报": s.last_bucket_ts || "—",
              "状态": (
                <StatusPill tone={sourceTone(s.success_rate)}>
                  {s.success_rate == null ? "无数据" : s.success_rate >= 99 ? "健康" : s.success_rate >= 90 ? "降级" : "异常"}
                </StatusPill>
              ),
            }))}
          />
        )}
      </Card>
    </Layout>
  );
}
