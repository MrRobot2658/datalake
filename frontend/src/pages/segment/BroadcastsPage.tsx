import { useEffect, useState } from "react";
import { Plus, Send } from "lucide-react";
import Layout from "../../components/layout/Layout";
import { Button, Card, DataTable, Spinner, Modal, TextField } from "../../components/ui";
import { StatCards, EmptyState, StatusPill } from "../../components/segment/kit";
import { useTenant } from "../../context/TenantContext";
import {
  listBroadcasts, createBroadcast, type Broadcast, type BroadcastStatus, type ChannelType,
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

export default function BroadcastsPage() {
  const { tenant } = useTenant();
  const [rows, setRows] = useState<Broadcast[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [channel, setChannel] = useState<ChannelType>("email");
  const [subject, setSubject] = useState("");
  const [saving, setSaving] = useState(false);

  function reload() {
    setRows(null); setErr(null);
    listBroadcasts(tenant).then(setRows).catch((e) => setErr(String(e)));
  }
  useEffect(reload, [tenant]);

  async function onCreate() {
    if (!code.trim()) return;
    setSaving(true);
    try {
      await createBroadcast({
        tenant_id: tenant,
        broadcast_code: code.trim(),
        broadcast_name: name.trim() || code.trim(),
        channel_type: channel,
        subject: subject.trim() || undefined,
      });
      setOpen(false); setCode(""); setName(""); setSubject("");
      reload();
    } catch (e: any) {
      setErr(e?.response?.data?.detail || String(e));
    } finally {
      setSaving(false);
    }
  }

  const view = (rows || []).map((b) => ({
    名称: b.broadcast_name || b.broadcast_code,
    渠道: b.channel_type ? (CHANNEL_LABEL[b.channel_type] ?? b.channel_type) : "—",
    主题: b.subject || "—",
    预估受众: (b.estimated_size ?? 0).toLocaleString(),
    状态: <StatusPill tone={STATUS_TONE[b.status] ?? "gray"}>{STATUS_LABEL[b.status] ?? b.status}</StatusPill>,
    _id: b.broadcast_id,
  }));

  return (
    <Layout
      title="群发 Broadcasts"
      subtitle="面向受众的一次性群发触达，支持 Push、短信、微信与 EDM"
      actions={<Button onClick={() => setOpen(true)}><Plus className="h-4 w-4" /> 新建群发</Button>}
    >
      {err && <Card className="mb-4 p-5 text-sm text-red-600">{err}</Card>}
      {!rows && !err && <div className="flex items-center gap-2 text-gray-500"><Spinner /> 加载中…</div>}

      {rows && (
        <>
          <StatCards items={[
            { label: "群发任务", value: rows.length },
            { label: "已发送", value: rows.filter((b) => b.status === "sent").length },
            { label: "发送中", value: rows.filter((b) => b.status === "sending").length },
            { label: "预估总触达", value: rows.reduce((a, b) => a + (b.estimated_size || 0), 0).toLocaleString() },
          ]} />
          {rows.length === 0 ? (
            <EmptyState
              icon={Send}
              title="还没有群发任务"
              desc="选择一个受众与渠道，创建一次性群发触达。"
              action={<Button onClick={() => setOpen(true)}><Plus className="h-4 w-4" /> 新建第一个群发</Button>}
            />
          ) : (
            <Card className="p-2">
              <DataTable
                columns={["名称", "渠道", "主题", "预估受众", "状态"]}
                rows={view}
                rowLink={(r) => `/engage/broadcasts/${r._id}`}
              />
            </Card>
          )}
        </>
      )}

      <Modal open={open} title="新建群发" onClose={() => setOpen(false)}>
        <div className="space-y-4">
          <TextField label="群发标识（broadcast_code，唯一）" value={code} onChange={setCode} placeholder="如 spring_sale" />
          <TextField label="群发名称" value={name} onChange={setName} placeholder="春季大促群发" />
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-gray-700">渠道</span>
            <select
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-400 focus:outline-none"
              value={channel}
              onChange={(e) => setChannel(e.target.value as ChannelType)}
            >
              <option value="email">EDM 邮件</option>
              <option value="sms">短信</option>
              <option value="push">Push</option>
              <option value="wechat">微信</option>
            </select>
          </label>
          <TextField label="主题" value={subject} onChange={setSubject} placeholder="限时优惠，错过再等一年" />
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setOpen(false)}>取消</Button>
            <Button onClick={onCreate} disabled={saving || !code.trim()}>
              {saving ? "创建中…" : "创建"}
            </Button>
          </div>
        </div>
      </Modal>
    </Layout>
  );
}
