import { useCallback, useEffect, useState } from "react";
import { Plus, Search, BadgeCheck } from "lucide-react";
import Layout from "../components/layout/Layout";
import { Card, DataTable, Button, Spinner, Badge, Modal, TextField } from "../components/ui";
import { StatCards } from "../components/segment/kit";
import { useTenant } from "../context/TenantContext";
import {
  listConsentCategories,
  createConsentCategory,
  getConsent,
  type ConsentCategory,
  type ConsentRecord,
} from "../api/privacy";

export default function PrivacyConsentPage() {
  const { tenant } = useTenant();
  const [cats, setCats] = useState<ConsentCategory[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // 新建分类
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [required, setRequired] = useState(false);
  const [vendors, setVendors] = useState("");
  const [saving, setSaving] = useState(false);

  // 用户同意查询
  const [oneId, setOneId] = useState("");
  const [records, setRecords] = useState<ConsentRecord[] | null>(null);
  const [lookupErr, setLookupErr] = useState<string | null>(null);
  const [looking, setLooking] = useState(false);

  const load = useCallback(() => {
    setCats(null); setErr(null);
    listConsentCategories(tenant).then(setCats).catch((e) => setErr(String(e)));
  }, [tenant]);

  useEffect(() => { load(); }, [load]);

  const save = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      await createConsentCategory({
        tenant_id: tenant,
        category_name: name.trim(),
        description: desc.trim() || undefined,
        is_required: required,
        vendor_list: vendors.split(",").map((v) => v.trim()).filter(Boolean),
        created_by: "console",
      });
      setOpen(false); setName(""); setDesc(""); setRequired(false); setVendors("");
      load();
    } catch (e) { setErr(String(e)); }
    finally { setSaving(false); }
  };

  const lookup = async () => {
    const id = Number(oneId);
    if (!id) return;
    setLooking(true); setLookupErr(null); setRecords(null);
    try {
      const r = await getConsent(tenant, id);
      setRecords(r.records);
    } catch (e) { setLookupErr(String(e)); }
    finally { setLooking(false); }
  };

  return (
    <Layout
      title="同意管理 Consent"
      subtitle="管理同意分类与厂商映射，按主体（one_id）查询授权状态（来自 /privacy/consent）"
      actions={<Button onClick={() => setOpen(true)}><Plus className="h-4 w-4" /> 新建分类</Button>}
    >
      {err && <Card className="mb-4 p-4 text-sm text-red-600">{err}</Card>}

      <StatCards items={[
        { label: "同意分类数", value: cats ? cats.length : "…" },
        { label: "必选类", value: cats ? cats.filter((c) => c.is_required).length : "…" },
        { label: "厂商总数", value: cats ? cats.reduce((a, c) => a + (c.vendors?.length || 0), 0) : "…" },
        { label: "可选类", value: cats ? cats.filter((c) => !c.is_required).length : "…" },
      ]} />

      {!cats && !err && <div className="flex items-center gap-2 text-gray-500"><Spinner /> 加载中…</div>}
      {cats && (
        <Card className="mb-6 p-2">
          <div className="px-3 py-2 text-sm font-medium text-gray-700">同意分类</div>
          <DataTable
            columns={["分类", "说明", "是否必选", "同意率", "厂商"]}
            rows={cats.map((c) => ({
              "分类": c.category_name,
              "说明": c.description || "—",
              "是否必选": c.is_required ? <Badge color="brand">必选</Badge> : <Badge>可选</Badge>,
              "同意率": `${c.optedIn_pct}%`,
              "厂商": (c.vendors && c.vendors.length) ? c.vendors.join(", ") : "—",
            }))}
          />
        </Card>
      )}

      {/* 主体同意查询 */}
      <Card className="p-5">
        <div className="mb-3 flex items-center gap-2 text-sm font-medium text-gray-700">
          <BadgeCheck className="h-4 w-4 text-brand-500" /> 主体同意查询
        </div>
        <div className="flex items-end gap-3">
          <div className="w-56">
            <TextField label="OneID" value={oneId} onChange={setOneId} placeholder="输入 one_id" />
          </div>
          <Button variant="outline" onClick={lookup} disabled={looking || !oneId}>
            {looking ? <Spinner /> : <Search className="h-4 w-4" />} 查询
          </Button>
        </div>
        {lookupErr && <div className="mt-3 text-sm text-red-600">{lookupErr}</div>}
        {records && (
          <div className="mt-4">
            {records.length === 0 ? (
              <div className="text-sm text-gray-400">该主体暂无同意记录</div>
            ) : (
              <DataTable
                columns={["分类", "授权状态", "授权时间", "撤回时间"]}
                rows={records.map((r) => ({
                  "分类": r.category_name || `#${r.category_id}`,
                  "授权状态": r.granted ? <Badge color="green">已授权</Badge> : <Badge color="red">未授权</Badge>,
                  "授权时间": r.granted_at || "—",
                  "撤回时间": r.withdrawn_at || "—",
                }))}
              />
            )}
          </div>
        )}
      </Card>

      <Modal open={open} title="新建同意分类" onClose={() => setOpen(false)}>
        <div className="space-y-4">
          <TextField label="分类名称" value={name} onChange={setName} placeholder="如 营销邮件 / 个性化推荐" />
          <TextField label="说明" value={desc} onChange={setDesc} placeholder="可选" />
          <TextField label="厂商（逗号分隔）" value={vendors} onChange={setVendors} placeholder="如 微信, 巨量引擎" />
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input type="checkbox" checked={required} onChange={(e) => setRequired(e.target.checked)} />
            必选分类（用户不可拒绝）
          </label>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={() => setOpen(false)}>取消</Button>
            <Button onClick={save} disabled={saving || !name.trim()}>
              {saving ? <Spinner /> : "保存"}
            </Button>
          </div>
        </div>
      </Modal>
    </Layout>
  );
}
