import { useCallback, useEffect, useState } from "react";
import { Save } from "lucide-react";
import Layout from "../../components/layout/Layout";
import { Button, Card, Spinner, TextField } from "../../components/ui";
import { SubTabs } from "../../components/segment/kit";
import { useTenant } from "../../context/TenantContext";
import { getWorkspace, updateWorkspace, type Workspace } from "../../api/settings";

const TABS = [
  { label: "通用", to: "/settings" },
  { label: "权限管理", to: "/settings/access" },
  { label: "API 令牌", to: "/settings/tokens" },
  { label: "审计日志", to: "/settings/audit" },
];

export default function SettingsGeneralPage() {
  const { tenant } = useTenant();
  const [ws, setWs] = useState<Workspace | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // 可编辑字段
  const [name, setName] = useState("");
  const [region, setRegion] = useState("");
  const [plan, setPlan] = useState("");

  const load = useCallback(async () => {
    setWs(null); setError(null); setMsg(null);
    try {
      const w = await getWorkspace(tenant);
      setWs(w);
      setName(w.name || "");
      setRegion(w.region || "");
      setPlan(w.plan || "");
    } catch (e: any) {
      setError(e?.response?.data?.detail || e.message || "加载失败");
    }
  }, [tenant]);

  useEffect(() => { load(); }, [load]);

  async function save() {
    setSaving(true); setError(null); setMsg(null);
    try {
      const w = await updateWorkspace(tenant, { name, region, plan });
      setWs(w);
      setMsg("已保存工作区设置");
    } catch (e: any) {
      setError(e?.response?.data?.detail || e.message || "保存失败");
    } finally {
      setSaving(false);
    }
  }

  const dirty = !!ws && (name !== ws.name || region !== ws.region || plan !== ws.plan);

  return (
    <Layout
      title="通用 General"
      subtitle="工作区基本信息与归属租户"
      actions={
        <Button onClick={save} disabled={!dirty || saving}>
          {saving ? <Spinner /> : <Save className="h-4 w-4" />} 保存
        </Button>
      }
    >
      <SubTabs tabs={TABS.map((t) => ({ ...t, active: t.label === "通用" }))} />

      {error && <div className="mb-4 rounded-lg bg-red-50 px-4 py-2 text-sm text-red-600">{error}</div>}
      {msg && <div className="mb-4 rounded-lg bg-brand-50 px-4 py-2 text-sm text-brand-700">{msg}</div>}

      {!ws && !error && <div className="flex items-center gap-2 text-gray-500"><Spinner /> 加载中…</div>}

      {ws && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <Card className="p-6">
            <div className="mb-4 text-base font-semibold text-gray-900">工作区 Workspace</div>
            <div className="space-y-4">
              <TextField label="名称" value={name} onChange={setName} placeholder="工作区名称" />
              <TextField label="区域 region" value={region} onChange={setRegion} placeholder="如 cn-east" />
              <TextField label="套餐 plan" value={plan} onChange={setPlan} placeholder="standard / premium" />
            </div>
          </Card>

          <Card className="p-6">
            <div className="mb-4 text-base font-semibold text-gray-900">基础信息（只读）</div>
            <dl className="space-y-3">
              {[
                { k: "工作区 ID", v: String(ws.id) },
                { k: "标识 slug", v: ws.slug },
                { k: "档位 tier", v: ws.tier },
                { k: "Kafka Topic", v: ws.kafka_topic || "—" },
                { k: "创建时间", v: ws.created_at },
              ].map((r) => (
                <div key={r.k} className="flex justify-between gap-4 border-b border-gray-100 py-2">
                  <dt className="text-sm text-gray-500">{r.k}</dt>
                  <dd className="text-sm font-medium text-gray-900">{r.v}</dd>
                </div>
              ))}
            </dl>
          </Card>
        </div>
      )}
    </Layout>
  );
}
