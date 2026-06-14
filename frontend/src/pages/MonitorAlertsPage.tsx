import { useCallback, useEffect, useState } from "react";
import { Plus, RefreshCw, Play, Trash2, BellRing, Check, CheckCheck } from "lucide-react";
import Layout from "../components/layout/Layout";
import { Card, DataTable, Button, Spinner, Badge, Modal, TextField } from "../components/ui";
import { StatCards, StatusPill } from "../components/segment/kit";
import { useTenant } from "../context/TenantContext";
import {
  listAlertRules,
  createAlertRule,
  deleteAlertRule,
  evaluateAlertRule,
  listAlertEvents,
  acknowledgeAlertEvent,
  resolveAlertEvent,
  type AlertRule,
  type AlertEvent,
  type AlertMetric,
  type AlertOperator,
  type AlertSeverity,
} from "../api/monitor";

const METRICS: { value: AlertMetric; label: string }[] = [
  { value: "success_rate", label: "成功率(%)" },
  { value: "error_rate", label: "错误率(%)" },
  { value: "event_count", label: "事件量" },
  { value: "latency_p95", label: "P95 时延(ms)" },
];
const OPERATORS: { value: AlertOperator; label: string }[] = [
  { value: "lt", label: "小于 <" },
  { value: "lte", label: "小于等于 ≤" },
  { value: "gt", label: "大于 >" },
  { value: "gte", label: "大于等于 ≥" },
  { value: "eq", label: "等于 =" },
];
const SEVERITIES: { value: AlertSeverity; label: string; color: string }[] = [
  { value: "high", label: "高", color: "red" },
  { value: "medium", label: "中", color: "amber" },
  { value: "low", label: "低", color: "gray" },
];

const metricLabel = (v: string) => METRICS.find((m) => m.value === v)?.label || v;
const opLabel = (v: string) => OPERATORS.find((o) => o.value === v)?.label || v;
const sevColor = (v: string) => SEVERITIES.find((s) => s.value === v)?.color || "gray";
const sevLabel = (v: string) => SEVERITIES.find((s) => s.value === v)?.label || v;

function Select({
  label, value, onChange, options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-gray-700">{label}</span>
      <select
        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-400 focus:outline-none"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </label>
  );
}

function eventTone(s: string): "amber" | "blue" | "green" | "gray" {
  if (s === "triggered") return "amber";
  if (s === "acknowledged") return "blue";
  if (s === "resolved") return "green";
  return "gray";
}
const eventStatusLabel: Record<string, string> = {
  triggered: "已触发",
  acknowledged: "已确认",
  resolved: "已解决",
};

export default function MonitorAlertsPage() {
  const { tenant } = useTenant();
  const [tab, setTab] = useState<"rules" | "events">("rules");
  const [rules, setRules] = useState<AlertRule[] | null>(null);
  const [events, setEvents] = useState<AlertEvent[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<number | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  // 新建规则表单
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [metric, setMetric] = useState<string>("success_rate");
  const [operator, setOperator] = useState<string>("lt");
  const [threshold, setThreshold] = useState("95");
  const [windowMin, setWindowMin] = useState("5");
  const [channel, setChannel] = useState("feishu");
  const [severity, setSeverity] = useState<string>("medium");
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    setErr(null);
    Promise.all([listAlertRules(tenant), listAlertEvents(tenant, { limit: 100 })])
      .then(([r, e]) => {
        setRules(r);
        setEvents(e);
      })
      .catch((e) => setErr(String(e)))
      .finally(() => setLoading(false));
  }, [tenant]);

  useEffect(() => {
    load();
  }, [load]);

  const flash = (m: string) => {
    setToast(m);
    setTimeout(() => setToast(null), 2500);
  };

  const save = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      await createAlertRule(tenant, {
        name: name.trim(),
        metric,
        operator,
        threshold: Number(threshold),
        window_minutes: Number(windowMin) || 5,
        channel: channel.trim() || "feishu",
        severity,
        enabled: true,
      });
      setOpen(false);
      setName("");
      load();
      flash("告警规则已创建");
    } catch (e) {
      setErr(String(e));
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: number) => {
    if (!confirm("确认删除该告警规则？关联触发记录会一并删除。")) return;
    setBusy(id);
    try {
      await deleteAlertRule(tenant, id);
      load();
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(null);
    }
  };

  const evaluate = async (id: number) => {
    setBusy(id);
    try {
      const r = await evaluateAlertRule(tenant, id, true);
      flash(
        r.breached
          ? `已触发：${metricLabel(r.metric)} 当前 ${r.metric_value ?? "—"}`
          : `未越界：${metricLabel(r.metric)} 当前 ${r.metric_value ?? "—"}`,
      );
      if (r.breached) load();
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(null);
    }
  };

  const ack = async (id: number) => {
    setBusy(id);
    try {
      await acknowledgeAlertEvent(tenant, id, "console");
      load();
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(null);
    }
  };

  const resolve = async (id: number) => {
    setBusy(id);
    try {
      await resolveAlertEvent(tenant, id);
      load();
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(null);
    }
  };

  const triggered = (events || []).filter((e) => e.status === "triggered").length;

  return (
    <Layout
      title="告警 Alerts"
      subtitle="为投递成功率、事件量、错误率与时延设置阈值，越界即触发（来自 /monitor/alert-rules · /alert-events）"
      actions={
        <>
          <Button variant="outline" onClick={load} disabled={loading}>
            {loading ? <Spinner /> : <RefreshCw className="h-4 w-4" />} 刷新
          </Button>
          <Button onClick={() => setOpen(true)}>
            <Plus className="h-4 w-4" /> 新建告警
          </Button>
        </>
      }
    >
      {err && <Card className="mb-4 p-4 text-sm text-red-600">{err}</Card>}
      {toast && (
        <Card className="mb-4 border-brand-200 bg-brand-50 p-3 text-sm text-brand-700">{toast}</Card>
      )}

      <StatCards
        items={[
          { label: "告警规则", value: rules ? rules.length : "…" },
          { label: "已启用", value: rules ? rules.filter((r) => r.enabled).length : "…" },
          { label: "触发记录", value: events ? events.length : "…" },
          { label: "待处理", value: events ? triggered : "…", tone: triggered ? "red" : "green" },
        ]}
      />

      <div className="mb-5 flex gap-1 border-b border-gray-200">
        {([
          ["rules", "告警规则"],
          ["events", "触发记录"],
        ] as const).map(([k, lbl]) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
              tab === k ? "border-brand-500 text-brand-700" : "border-transparent text-gray-500 hover:text-gray-800"
            }`}
          >
            {lbl}
          </button>
        ))}
      </div>

      {tab === "rules" && (
        <Card className="p-2">
          {!rules ? (
            <div className="flex items-center gap-2 px-3 py-6 text-gray-500">
              <Spinner /> 加载中…
            </div>
          ) : (
            <DataTable
              columns={["规则", "条件", "窗口", "渠道", "级别", "状态", "操作"]}
              rows={rules.map((r) => ({
                "规则": r.name,
                "条件": `${metricLabel(r.metric)} ${opLabel(r.operator)} ${r.threshold}`,
                "窗口": `${r.window_minutes} 分钟`,
                "渠道": r.channel,
                "级别": <Badge color={sevColor(r.severity)}>{sevLabel(r.severity)}</Badge>,
                "状态": r.enabled ? <Badge color="green">启用</Badge> : <Badge>停用</Badge>,
                "操作": (
                  <div className="flex gap-1">
                    <Button variant="ghost" onClick={() => evaluate(r.id)} disabled={busy === r.id}>
                      {busy === r.id ? <Spinner /> : <Play className="h-3.5 w-3.5" />} 评估
                    </Button>
                    <Button variant="ghost" onClick={() => remove(r.id)} disabled={busy === r.id}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ),
              }))}
            />
          )}
        </Card>
      )}

      {tab === "events" && (
        <Card className="p-2">
          {!events ? (
            <div className="flex items-center gap-2 px-3 py-6 text-gray-500">
              <Spinner /> 加载中…
            </div>
          ) : (
            <DataTable
              columns={["触发时间", "规则", "指标", "指标值", "状态", "确认人", "操作"]}
              rows={events.map((e) => ({
                "触发时间": e.fired_at,
                "规则": e.rule_name || `#${e.rule_id}`,
                "指标": e.metric ? metricLabel(e.metric) : "—",
                "指标值": e.metric_value ?? "—",
                "状态": <StatusPill tone={eventTone(e.status)}>{eventStatusLabel[e.status] || e.status}</StatusPill>,
                "确认人": e.acknowledged_by || "—",
                "操作": (
                  <div className="flex gap-1">
                    {e.status === "triggered" && (
                      <Button variant="ghost" onClick={() => ack(e.id)} disabled={busy === e.id}>
                        {busy === e.id ? <Spinner /> : <Check className="h-3.5 w-3.5" />} 确认
                      </Button>
                    )}
                    {e.status !== "resolved" && (
                      <Button variant="ghost" onClick={() => resolve(e.id)} disabled={busy === e.id}>
                        <CheckCheck className="h-3.5 w-3.5" /> 解决
                      </Button>
                    )}
                    {e.status === "resolved" && <span className="px-2 text-xs text-gray-400">已闭环</span>}
                  </div>
                ),
              }))}
            />
          )}
        </Card>
      )}

      <Modal open={open} title="新建告警规则" onClose={() => setOpen(false)}>
        <div className="space-y-4">
          <TextField label="规则名称" value={name} onChange={setName} placeholder="如 成功率跌破 95%" />
          <div className="grid grid-cols-2 gap-3">
            <Select label="监控指标" value={metric} onChange={setMetric} options={METRICS} />
            <Select label="比较" value={operator} onChange={setOperator} options={OPERATORS} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <TextField label="阈值" value={threshold} onChange={setThreshold} placeholder="如 95" />
            <TextField label="窗口（分钟）" value={windowMin} onChange={setWindowMin} placeholder="5" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <TextField label="通知渠道" value={channel} onChange={setChannel} placeholder="feishu / email / webhook" />
            <Select label="级别" value={severity} onChange={setSeverity} options={SEVERITIES} />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={() => setOpen(false)}>取消</Button>
            <Button onClick={save} disabled={saving || !name.trim()}>
              {saving ? <Spinner /> : <BellRing className="h-4 w-4" />} 保存
            </Button>
          </div>
        </div>
      </Modal>
    </Layout>
  );
}
