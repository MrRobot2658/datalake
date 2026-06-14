import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Plus, Trash2, ArrowLeft, ShieldCheck } from "lucide-react";
import Layout from "../../components/layout/Layout";
import { Button, Card, Modal, Spinner, TextField } from "../../components/ui";
import { StatCards, StatusPill, EmptyState } from "../../components/segment/kit";
import { useTenant } from "../../context/TenantContext";
import {
  getTrackingPlan, listPlanEvents, createPlanEvent, deletePlanEvent, validateEvent,
  type TrackingPlan, type PlanEvent, type ValidateResult,
} from "../../api/protocols";

export default function TrackingPlanDetailPage() {
  const { tenant } = useTenant();
  const { id } = useParams();
  const planId = Number(id);
  const navigate = useNavigate();

  const [plan, setPlan] = useState<TrackingPlan | null>(null);
  const [events, setEvents] = useState<PlanEvent[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // 新建事件
  const [open, setOpen] = useState(false);
  const [evName, setEvName] = useState("");
  const [evType, setEvType] = useState("track");
  const [evRequired, setEvRequired] = useState("");
  const [evProps, setEvProps] = useState("");
  const [busy, setBusy] = useState(false);

  // 校验
  const [valOpen, setValOpen] = useState(false);
  const [valEvent, setValEvent] = useState("");
  const [valPayload, setValPayload] = useState("{\n  \n}");
  const [valResult, setValResult] = useState<ValidateResult | null>(null);
  const [valBusy, setValBusy] = useState(false);

  function load() {
    setErr(null);
    getTrackingPlan(tenant, planId).then(setPlan).catch((e) => setErr(String(e)));
    setEvents(null);
    listPlanEvents(tenant, planId).then(setEvents).catch((e) => setErr(String(e)));
  }
  useEffect(load, [tenant, planId]);

  async function createEvent() {
    if (!evName.trim()) return;
    setBusy(true);
    try {
      let props: Record<string, any> | null = null;
      if (evProps.trim()) props = JSON.parse(evProps);
      await createPlanEvent(tenant, planId, {
        event: evName.trim(),
        type: evType,
        required: evRequired.split(",").map((s) => s.trim()).filter(Boolean),
        properties_json: props,
        status: "draft",
      });
      setOpen(false); setEvName(""); setEvRequired(""); setEvProps("");
      load();
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function removeEvent(ev: PlanEvent) {
    if (!confirm(`删除事件「${ev.event}」？`)) return;
    try { await deletePlanEvent(tenant, ev.id); load(); }
    catch (e) { setErr(String(e)); }
  }

  function openValidate(prefill?: string) {
    setValEvent(prefill || "");
    setValResult(null);
    setValOpen(true);
  }

  async function runValidate() {
    setValBusy(true); setValResult(null);
    try {
      let payload: Record<string, any> = {};
      if (valPayload.trim()) payload = JSON.parse(valPayload);
      const res = await validateEvent(tenant, planId, {
        event: valEvent.trim(),
        properties: payload,
        record_violation: true,
      });
      setValResult(res);
      // 校验可能产生违规，刷新事件状态不必，但保持轻量
    } catch (e) {
      setErr(String(e));
    } finally {
      setValBusy(false);
    }
  }

  const total = events?.length ?? 0;
  const approved = events?.filter((e) => e.status === "approved").length ?? 0;

  return (
    <Layout
      title={plan ? `埋点计划 · ${plan.name}` : "埋点计划"}
      subtitle={plan?.description || "管理该计划下的事件 schema 与必填属性，并对载荷做校验"}
      actions={
        <>
          <Button variant="outline" onClick={() => navigate("/protocols")}>
            <ArrowLeft className="h-4 w-4" /> 返回
          </Button>
          <Button variant="outline" onClick={() => openValidate()}>
            <ShieldCheck className="h-4 w-4" /> 校验事件
          </Button>
          <Button onClick={() => setOpen(true)}><Plus className="h-4 w-4" /> 新建事件</Button>
        </>
      }
    >
      <StatCards items={[
        { label: "事件总数", value: total },
        { label: "已批准", value: approved },
        { label: "草稿", value: total - approved },
        { label: "数据源", value: (plan?.sources || []).join(", ") || "—" },
      ]} />

      {err && <Card className="mb-4 p-4 text-sm text-red-600">{err}</Card>}
      {!events && !err && <div className="flex items-center gap-2 text-gray-500"><Spinner /> 加载中…</div>}

      {events && events.length === 0 && (
        <EmptyState
          icon={ShieldCheck}
          title="该计划暂无事件"
          desc="添加事件 schema 以定义属性、类型与必填项。"
          action={<Button onClick={() => setOpen(true)}><Plus className="h-4 w-4" /> 新建事件</Button>}
        />
      )}

      {events && events.length > 0 && (
        <Card className="p-2">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wider text-gray-400">
                <th className="px-4 py-3 font-semibold">事件</th>
                <th className="px-4 py-3 font-semibold">类型</th>
                <th className="px-4 py-3 font-semibold">属性数</th>
                <th className="px-4 py-3 font-semibold">必填</th>
                <th className="px-4 py-3 font-semibold">状态</th>
                <th className="px-4 py-3 font-semibold">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {events.map((ev) => (
                <tr key={ev.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium text-gray-900">{ev.event}</td>
                  <td className="px-4 py-3 text-gray-700">{ev.type}</td>
                  <td className="px-4 py-3 text-gray-700">{Object.keys(ev.properties_json || {}).length}</td>
                  <td className="px-4 py-3 text-gray-500">{(ev.required || []).join(", ") || "—"}</td>
                  <td className="px-4 py-3">
                    {ev.status === "approved"
                      ? <StatusPill tone="green">已批准</StatusPill>
                      : <StatusPill tone="amber">草稿</StatusPill>}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <button className="text-xs text-brand-600 hover:underline" onClick={() => openValidate(ev.event)}>校验</button>
                      <button className="text-gray-400 hover:text-red-600" onClick={() => removeEvent(ev)} title="删除">
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {/* 新建事件 */}
      <Modal open={open} title="新建事件 Schema" onClose={() => setOpen(false)}>
        <div className="space-y-4">
          <TextField label="事件名" value={evName} onChange={setEvName} placeholder="如：Order Completed" />
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-gray-700">类型</span>
            <select className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-400 focus:outline-none"
              value={evType} onChange={(e) => setEvType(e.target.value)}>
              <option value="track">track</option>
              <option value="identify">identify</option>
            </select>
          </label>
          <TextField label="必填属性（逗号分隔）" value={evRequired} onChange={setEvRequired} placeholder="order_id, total" />
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-gray-700">属性 schema（JSON，属性名→类型）</span>
            <textarea className="h-28 w-full rounded-lg border border-gray-300 px-3 py-2 font-mono text-xs focus:border-brand-400 focus:outline-none"
              value={evProps} onChange={(e) => setEvProps(e.target.value)}
              placeholder={'{ "order_id": "string", "total": "number" }'} />
          </label>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setOpen(false)}>取消</Button>
            <Button onClick={createEvent} disabled={busy || !evName.trim()}>{busy ? "创建中…" : "创建"}</Button>
          </div>
        </div>
      </Modal>

      {/* 校验事件载荷 */}
      <Modal open={valOpen} title="校验事件载荷" onClose={() => setValOpen(false)}>
        <div className="space-y-4">
          <TextField label="事件名" value={valEvent} onChange={setValEvent} placeholder="如：Order Completed" />
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-gray-700">载荷 properties（JSON）</span>
            <textarea className="h-28 w-full rounded-lg border border-gray-300 px-3 py-2 font-mono text-xs focus:border-brand-400 focus:outline-none"
              value={valPayload} onChange={(e) => setValPayload(e.target.value)} />
          </label>
          {valResult && (
            <div className={`rounded-lg p-3 text-sm ${valResult.valid ? "bg-brand-50 text-brand-700" : "bg-red-50 text-red-700"}`}>
              {valResult.valid ? "校验通过，符合 schema。" : (
                <ul className="list-disc pl-4">
                  {valResult.issues.map((it, i) => <li key={i}>{it}</li>)}
                </ul>
              )}
            </div>
          )}
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setValOpen(false)}>关闭</Button>
            <Button onClick={runValidate} disabled={valBusy || !valEvent.trim()}>{valBusy ? "校验中…" : "校验"}</Button>
          </div>
        </div>
      </Modal>
    </Layout>
  );
}
