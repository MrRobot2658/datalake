import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Building2, Plus, Search } from "lucide-react";
import Layout from "../../components/layout/Layout";
import { Button, Card, DataTable, Modal, Spinner, TextField } from "../../components/ui";
import { StatCards, StatusPill, SubTabs } from "../../components/segment/kit";
import {
  createTenant,
  listTenants,
  type TenantRow,
} from "../../api/platform";

// 设置区子页签（与既有 settings 页一致，新增「租户管理」）
const TABS = [
  { label: "通用", to: "/settings" },
  { label: "权限管理", to: "/settings/access" },
  { label: "API 令牌", to: "/settings/tokens" },
  { label: "审计日志", to: "/settings/audit" },
  { label: "租户管理", to: "/settings/tenants" },
];

const TIERS = ["", "premium", "standard"];
const STATUSES = ["", "active", "suspended"];
const SCALES = ["dev", "medium", "large", "xlarge"];

function statusTone(s: string) {
  return s === "active" ? "green" : s === "suspended" ? "red" : "gray";
}

export default function TenantsPage() {
  const navigate = useNavigate();
  const [rows, setRows] = useState<TenantRow[] | null>(null);
  const [total, setTotal] = useState(0);
  const [err, setErr] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [tier, setTier] = useState("");
  const [status, setStatus] = useState("");

  const [createOpen, setCreateOpen] = useState(false);

  function reload() {
    setRows(null);
    setErr(null);
    listTenants({
      search: search || undefined,
      tier: tier || undefined,
      status: status || undefined,
      limit: 200,
    })
      .then((r) => {
        setRows(r.tenants);
        setTotal(r.total);
      })
      .catch((e) => setErr(String(e?.response?.data?.detail || e)));
  }

  // 筛选条件变化即重查（搜索框走回车/按钮）
  useEffect(reload, [tier, status]);
  useEffect(reload, []);

  const view = (rows || []).map((r) => ({
    租户ID: r.tenant_id,
    名称: r.tenant_name,
    档位: r.tier,
    状态: <StatusPill tone={statusTone(r.status)}>{r.status}</StatusPill>,
    规模: r.scale_tier,
    "近24h事件": r.events_count_24h,
    联系人: r.contact_email || "—",
    _id: r.tenant_id,
  }));

  const activeN = (rows || []).filter((r) => r.status === "active").length;

  return (
    <Layout
      title="租户管理 Tenant Management"
      subtitle="平台级多租户治理 —— 租户清单、生命周期与每租户独立配置"
      actions={
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4" /> 新建租户
        </Button>
      }
    >
      <SubTabs tabs={TABS.map((t) => ({ ...t, active: t.label === "租户管理" }))} />

      <StatCards
        items={[
          { label: "租户总数", value: total },
          { label: "活跃", value: activeN, tone: "green" },
          { label: "停用", value: (rows?.length ?? 0) - activeN, tone: "red" },
        ]}
      />

      {/* 搜索 / 筛选 */}
      <Card className="mb-4 p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[220px] flex-1">
            <label className="block">
              <span className="mb-1 block text-sm font-medium text-gray-700">搜索</span>
              <div className="flex gap-2">
                <input
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-400 focus:outline-none"
                  value={search}
                  placeholder="名称或租户 ID"
                  onChange={(e) => setSearch(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && reload()}
                />
                <Button variant="outline" onClick={reload}>
                  <Search className="h-4 w-4" />
                </Button>
              </div>
            </label>
          </div>
          <Select label="档位 tier" value={tier} onChange={setTier} options={TIERS} />
          <Select label="状态 status" value={status} onChange={setStatus} options={STATUSES} />
        </div>
      </Card>

      {err && <Card className="p-5 text-sm text-red-600">{err}</Card>}
      {!rows && !err && (
        <div className="flex items-center gap-2 text-gray-500">
          <Spinner /> 加载中…
        </div>
      )}
      {rows && (
        <Card className="p-2">
          <div className="px-3 pb-2 pt-3 text-sm font-semibold text-gray-700">
            租户列表 <span className="ml-2 font-normal text-gray-400">· 点击行进入配置中心</span>
          </div>
          <DataTable
            columns={["租户ID", "名称", "档位", "状态", "规模", "近24h事件", "联系人"]}
            rows={view}
            rowLink={(r) => `/settings/tenants/${r._id}`}
          />
        </Card>
      )}

      <CreateTenantModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={(id) => {
          setCreateOpen(false);
          navigate(`/settings/tenants/${id}`);
        }}
      />
    </Layout>
  );
}

function Select({
  label, value, onChange, options,
}: { label: string; value: string; onChange: (v: string) => void; options: string[] }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-gray-700">{label}</span>
      <select
        className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-400 focus:outline-none"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {options.map((o) => (
          <option key={o} value={o}>{o === "" ? "全部" : o}</option>
        ))}
      </select>
    </label>
  );
}

function CreateTenantModal({
  open, onClose, onCreated,
}: { open: boolean; onClose: () => void; onCreated: (id: number) => void }) {
  const [name, setName] = useState("");
  const [tier, setTier] = useState("standard");
  const [scale, setScale] = useState("dev");
  const [email, setEmail] = useState("");
  const [desc, setDesc] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    if (!name.trim()) {
      setErr("租户名称必填");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const r = await createTenant({
        tenant_name: name.trim(),
        tier,
        scale_tier: scale,
        contact_email: email || null,
        description: desc || null,
      });
      onCreated(r.tenant_id);
    } catch (e: any) {
      setErr(String(e?.response?.data?.detail || e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} title="新建租户" onClose={onClose}>
      <div className="space-y-4">
        <TextField label="租户名称" value={name} onChange={setName} placeholder="如：示例零售集团" />
        <div className="grid grid-cols-2 gap-3">
          <Select label="档位 tier" value={tier} onChange={setTier} options={["standard", "premium"]} />
          <Select label="规模 scale" value={scale} onChange={setScale} options={SCALES} />
        </div>
        <TextField label="联系人邮箱" value={email} onChange={setEmail} placeholder="可选" />
        <TextField label="描述" value={desc} onChange={setDesc} placeholder="可选" />
        {err && <div className="text-sm text-red-600">{err}</div>}
        <div className="flex items-center justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onClose}>取消</Button>
          <Button onClick={submit} disabled={busy}>
            {busy ? <Spinner /> : <Building2 className="h-4 w-4" />} 创建
          </Button>
        </div>
      </div>
    </Modal>
  );
}
