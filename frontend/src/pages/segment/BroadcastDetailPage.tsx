import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Send, Trash2 } from "lucide-react";
import Layout from "../../components/layout/Layout";
import { Button, Card, DataTable, Spinner, Badge } from "../../components/ui";
import { StatCards, StatusPill } from "../../components/segment/kit";
import { useTenant } from "../../context/TenantContext";
import {
  getBroadcast, getBroadcastStats, listBroadcastSends, sendBroadcast, deleteBroadcast,
  type Broadcast, type BroadcastStats, type BroadcastSend, type BroadcastStatus, type ChannelType,
} from "../../api/engage";

const STATUS_TONE: Record<BroadcastStatus, "green" | "amber" | "gray" | "blue" | "red"> = {
  sent: "green", sending: "blue", scheduled: "amber", draft: "gray", failed: "red",
};
const STATUS_LABEL: Record<BroadcastStatus, string> = {
  sent: "已发送", sending: "发送中", scheduled: "已排程", draft: "草稿", failed: "失败",
};
const CHANNEL_LABEL: Record<ChannelType, string> = {
  email: "EDM", sms: "短信", push: "Push", wechat: "微信",
};

export default function BroadcastDetailPage() {
  const { id } = useParams();
  const broadcastId = Number(id);
  const { tenant } = useTenant();
  const navigate = useNavigate();

  const [bc, setBc] = useState<Broadcast | null>(null);
  const [stats, setStats] = useState<BroadcastStats | null>(null);
  const [sends, setSends] = useState<BroadcastSend[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function reload() {
    setErr(null);
    getBroadcast(tenant, broadcastId).then(setBc).catch((e) => setErr(String(e)));
    getBroadcastStats(tenant, broadcastId).then(setStats).catch(() => {});
    listBroadcastSends(tenant, broadcastId).then(setSends).catch(() => {});
  }
  useEffect(reload, [tenant, broadcastId]);

  async function onSend() {
    if (!confirm("确认发送该群发任务？")) return;
    setBusy(true);
    try {
      const updated = await sendBroadcast(tenant, broadcastId);
      setBc(updated);
      reload();
    } catch (e) { setErr(String(e)); } finally { setBusy(false); }
  }

  async function onDelete() {
    if (!confirm("确认删除该群发任务？将同时删除发送回执。")) return;
    setBusy(true);
    try {
      await deleteBroadcast(tenant, broadcastId);
      navigate("/engage/broadcasts");
    } catch (e) { setErr(String(e)); setBusy(false); }
  }

  const sendRows = (sends || []).map((s) => ({
    OneID: s.one_id || "—",
    状态: s.status,
    发送时间: s.sent_at || "—",
    打开时间: s.opened_at || "—",
    点击时间: s.clicked_at || "—",
  }));

  const canSend = bc && (bc.status === "draft" || bc.status === "scheduled");

  return (
    <Layout
      title={bc ? (bc.broadcast_name || bc.broadcast_code) : "群发详情"}
      subtitle={bc?.subject || bc?.broadcast_code || ""}
      actions={bc && (
        <div className="flex items-center gap-2">
          <StatusPill tone={STATUS_TONE[bc.status] ?? "gray"}>
            {STATUS_LABEL[bc.status] ?? bc.status}
          </StatusPill>
          {canSend && (
            <Button onClick={onSend} disabled={busy}><Send className="h-4 w-4" /> 发送</Button>
          )}
          <Button variant="ghost" onClick={onDelete} disabled={busy}>
            <Trash2 className="h-4 w-4" /> 删除
          </Button>
        </div>
      )}
    >
      {err && <Card className="mb-4 p-5 text-sm text-red-600">{err}</Card>}
      {!bc && !err && <div className="flex items-center gap-2 text-gray-500"><Spinner /> 加载中…</div>}

      {bc && (
        <>
          <StatCards items={[
            { label: "总发送", value: (stats?.total ?? 0).toLocaleString() },
            { label: "已送达", value: (stats?.delivered ?? 0).toLocaleString() },
            { label: "打开", value: (stats?.opened_any ?? 0).toLocaleString() },
            { label: "点击", value: (stats?.clicked_any ?? 0).toLocaleString() },
          ]} />

          <Card className="mb-6 p-5">
            <div className="grid grid-cols-2 gap-4 text-sm md:grid-cols-4">
              <Info label="渠道" value={bc.channel_type ? (CHANNEL_LABEL[bc.channel_type] ?? bc.channel_type) : "—"} />
              <Info label="预估受众" value={(bc.estimated_size ?? 0).toLocaleString()} />
              <Info label="关联受众 ID" value={bc.segment_id ?? "—"} />
              <Info label="目的地" value={bc.destination_id ?? "—"} />
              <Info label="排程时间" value={bc.scheduled_at ?? "—"} />
              <Info label="发送时间" value={bc.sent_at ?? "—"} />
            </div>
          </Card>

          <Card className="p-2">
            <div className="flex items-center justify-between px-3 pb-2 pt-3">
              <div className="text-sm font-semibold text-gray-700">
                发送回执 <span className="ml-2 font-normal text-gray-400">· 最近 100 条</span>
              </div>
              <Badge color="brand">{sends?.length ?? 0} 条</Badge>
            </div>
            <DataTable columns={["OneID", "状态", "发送时间", "打开时间", "点击时间"]} rows={sendRows} />
          </Card>
        </>
      )}
    </Layout>
  );
}

function Info({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs font-medium uppercase tracking-wide text-gray-400">{label}</div>
      <div className="mt-1 text-gray-900">{value}</div>
    </div>
  );
}
