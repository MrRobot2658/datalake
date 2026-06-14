import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Play, Pause, Archive, Trash2 } from "lucide-react";
import Layout from "../../components/layout/Layout";
import { Button, Card, DataTable, Spinner, Badge } from "../../components/ui";
import { StatCards, StatusPill, SubTabs } from "../../components/segment/kit";
import { useTenant } from "../../context/TenantContext";
import {
  getJourney, getJourneyStats, listJourneyState, setJourneyStatus, deleteJourney,
  type Journey, type JourneyStats, type JourneyState, type JourneyStatus,
} from "../../api/engage";

const STATUS_TONE: Record<JourneyStatus, "green" | "amber" | "gray" | "blue"> = {
  active: "green", paused: "amber", draft: "blue", archived: "gray",
};
const STATUS_LABEL: Record<JourneyStatus, string> = {
  active: "运行中", paused: "已暂停", draft: "草稿", archived: "已归档",
};
const STEP_LABEL: Record<string, string> = {
  action: "动作", wait: "等待", split: "分流", exit: "退出",
};

export default function JourneyDetailPage() {
  const { id } = useParams();
  const journeyId = Number(id);
  const { tenant } = useTenant();
  const navigate = useNavigate();

  const [journey, setJourney] = useState<Journey | null>(null);
  const [stats, setStats] = useState<JourneyStats | null>(null);
  const [state, setState] = useState<JourneyState[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function reload() {
    setErr(null);
    getJourney(tenant, journeyId).then(setJourney).catch((e) => setErr(String(e)));
    getJourneyStats(tenant, journeyId).then(setStats).catch(() => {});
    listJourneyState(tenant, journeyId).then(setState).catch(() => {});
  }
  useEffect(reload, [tenant, journeyId]);

  async function changeStatus(status: JourneyStatus) {
    setBusy(true);
    try {
      const j = await setJourneyStatus(tenant, journeyId, status);
      setJourney(j);
    } catch (e) { setErr(String(e)); } finally { setBusy(false); }
  }

  async function onDelete() {
    if (!confirm("确认删除该旅程？将同时删除步骤与运行状态。")) return;
    setBusy(true);
    try {
      await deleteJourney(tenant, journeyId);
      navigate("/engage/journeys");
    } catch (e) { setErr(String(e)); setBusy(false); }
  }

  const stepRows = (journey?.steps || []).map((s) => ({
    顺序: s.step_order,
    名称: s.step_name || "—",
    类型: s.step_type ? (STEP_LABEL[s.step_type] ?? s.step_type) : "—",
    动作: s.action_type || "—",
    等待小时: s.wait_duration_hours ?? "—",
    目的地: s.destination_id || "—",
  }));

  const stateRows = (state || []).map((s) => ({
    OneID: s.one_id || "—",
    当前步骤: s.current_step_id ?? "—",
    状态: s.status,
    进入时间: s.entered_at || "—",
  }));

  return (
    <Layout
      title={journey ? (journey.journey_name || journey.journey_code) : "旅程详情"}
      subtitle={journey?.description || journey?.journey_code || ""}
      actions={journey && (
        <div className="flex items-center gap-2">
          <StatusPill tone={STATUS_TONE[journey.status] ?? "gray"}>
            {STATUS_LABEL[journey.status] ?? journey.status}
          </StatusPill>
          {journey.status !== "active" && (
            <Button variant="outline" onClick={() => changeStatus("active")} disabled={busy}>
              <Play className="h-4 w-4" /> 启动
            </Button>
          )}
          {journey.status === "active" && (
            <Button variant="outline" onClick={() => changeStatus("paused")} disabled={busy}>
              <Pause className="h-4 w-4" /> 暂停
            </Button>
          )}
          <Button variant="outline" onClick={() => changeStatus("archived")} disabled={busy}>
            <Archive className="h-4 w-4" /> 归档
          </Button>
          <Button variant="ghost" onClick={onDelete} disabled={busy}>
            <Trash2 className="h-4 w-4" /> 删除
          </Button>
        </div>
      )}
    >
      {err && <Card className="mb-4 p-5 text-sm text-red-600">{err}</Card>}
      {!journey && !err && <div className="flex items-center gap-2 text-gray-500"><Spinner /> 加载中…</div>}

      {journey && (
        <>
          <StatCards items={[
            { label: "进入总人数", value: (stats?.total ?? 0).toLocaleString() },
            { label: "进行中", value: (stats?.active ?? 0).toLocaleString() },
            { label: "已完成", value: (stats?.completed ?? 0).toLocaleString() },
            { label: "已退出", value: (stats?.exited ?? 0).toLocaleString() },
          ]} />

          <SubTabs tabs={[{ label: "步骤与运行", to: "#", active: true }]} />

          <Card className="mb-6 p-2">
            <div className="flex items-center justify-between px-3 pb-2 pt-3">
              <div className="text-sm font-semibold text-gray-700">旅程步骤</div>
              <Badge color="brand">{journey.steps?.length ?? 0} 步</Badge>
            </div>
            <DataTable columns={["顺序", "名称", "类型", "动作", "等待小时", "目的地"]} rows={stepRows} />
          </Card>

          <Card className="p-2">
            <div className="px-3 pb-2 pt-3 text-sm font-semibold text-gray-700">
              在旅程中的用户 <span className="ml-2 font-normal text-gray-400">· 最近 50 条</span>
            </div>
            <DataTable columns={["OneID", "当前步骤", "状态", "进入时间"]} rows={stateRows} />
          </Card>
        </>
      )}
    </Layout>
  );
}
