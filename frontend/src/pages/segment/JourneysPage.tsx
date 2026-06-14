import { useEffect, useState } from "react";
import { Plus, Route as RouteIcon } from "lucide-react";
import Layout from "../../components/layout/Layout";
import { Button, Card, DataTable, Spinner, Modal, TextField } from "../../components/ui";
import { StatCards, EmptyState, StatusPill } from "../../components/segment/kit";
import { useTenant } from "../../context/TenantContext";
import {
  listJourneys, createJourney, type Journey, type JourneyStatus,
} from "../../api/engage";

const STATUS_TONE: Record<JourneyStatus, "green" | "amber" | "gray" | "blue"> = {
  active: "green", paused: "amber", draft: "blue", archived: "gray",
};
const STATUS_LABEL: Record<JourneyStatus, string> = {
  active: "运行中", paused: "已暂停", draft: "草稿", archived: "已归档",
};
const TRIGGER_LABEL: Record<string, string> = {
  segment_entry: "进入受众", event: "事件触发", schedule: "定时",
};

export default function JourneysPage() {
  const { tenant } = useTenant();
  const [rows, setRows] = useState<Journey[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);

  function reload() {
    setRows(null); setErr(null);
    listJourneys(tenant).then(setRows).catch((e) => setErr(String(e)));
  }
  useEffect(reload, [tenant]);

  async function onCreate() {
    if (!code.trim()) return;
    setSaving(true);
    try {
      await createJourney({
        tenant_id: tenant,
        journey_code: code.trim(),
        journey_name: name.trim() || code.trim(),
        trigger_type: "segment_entry",
        status: "draft",
      });
      setOpen(false); setCode(""); setName("");
      reload();
    } catch (e: any) {
      setErr(e?.response?.data?.detail || String(e));
    } finally {
      setSaving(false);
    }
  }

  const view = (rows || []).map((j) => ({
    旅程: j.journey_name || j.journey_code,
    标识: j.journey_code,
    触发方式: j.trigger_type ? (TRIGGER_LABEL[j.trigger_type] ?? j.trigger_type) : "—",
    步骤数: j.steps?.length ?? 0,
    状态: <StatusPill tone={STATUS_TONE[j.status] ?? "gray"}>{STATUS_LABEL[j.status] ?? j.status}</StatusPill>,
    _id: j.journey_id,
  }));

  return (
    <Layout
      title="旅程 Journeys"
      subtitle="编排多步骤的用户自动化旅程，按条件分流与触达"
      actions={<Button onClick={() => setOpen(true)}><Plus className="h-4 w-4" /> 新建旅程</Button>}
    >
      {err && <Card className="mb-4 p-5 text-sm text-red-600">{err}</Card>}
      {!rows && !err && <div className="flex items-center gap-2 text-gray-500"><Spinner /> 加载中…</div>}

      {rows && (
        <>
          <StatCards items={[
            { label: "旅程总数", value: rows.length },
            { label: "运行中", value: rows.filter((j) => j.status === "active").length },
            { label: "草稿", value: rows.filter((j) => j.status === "draft").length },
            { label: "已暂停", value: rows.filter((j) => j.status === "paused").length },
          ]} />
          {rows.length === 0 ? (
            <EmptyState
              icon={RouteIcon}
              title="还没有旅程"
              desc="创建一个旅程，从受众进入、事件或定时触发，编排自动化触达。"
              action={<Button onClick={() => setOpen(true)}><Plus className="h-4 w-4" /> 新建第一个旅程</Button>}
            />
          ) : (
            <Card className="p-2">
              <DataTable
                columns={["旅程", "标识", "触发方式", "步骤数", "状态"]}
                rows={view}
                rowLink={(r) => `/engage/journeys/${r._id}`}
              />
            </Card>
          )}
        </>
      )}

      <Modal open={open} title="新建旅程" onClose={() => setOpen(false)}>
        <div className="space-y-4">
          <TextField label="旅程标识（journey_code，唯一）" value={code} onChange={setCode} placeholder="如 welcome_flow" />
          <TextField label="旅程名称" value={name} onChange={setName} placeholder="新用户欢迎旅程" />
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
