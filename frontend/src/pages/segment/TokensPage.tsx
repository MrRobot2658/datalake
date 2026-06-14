import { useCallback, useEffect, useState } from "react";
import { KeyRound, Plus, Trash2 } from "lucide-react";
import Layout from "../../components/layout/Layout";
import { Button, Card, DataTable, Modal, Spinner, TextField } from "../../components/ui";
import { StatusPill, SubTabs } from "../../components/segment/kit";
import { useTenant } from "../../context/TenantContext";
import { issueToken, listTokens, revokeToken, type ApiToken } from "../../api/settings";

const TABS = [
  { label: "通用", to: "/settings" },
  { label: "权限管理", to: "/settings/access" },
  { label: "API 令牌", to: "/settings/tokens" },
  { label: "审计日志", to: "/settings/audit" },
];

export default function TokensPage() {
  const { tenant } = useTenant();
  const [tokens, setTokens] = useState<ApiToken[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const r = await listTokens({ tenant_id: tenant, limit: 200 });
      setTokens(r.data);
    } catch (e: any) {
      setError(e?.response?.data?.detail || e.message || "加载失败");
    } finally {
      setLoading(false);
    }
  }, [tenant]);

  useEffect(() => { load(); }, [load]);

  async function revoke(t: ApiToken) {
    if (!confirm(`吊销令牌「${t.label}」？吊销后无法恢复。`)) return;
    setError(null); setMsg(null);
    try {
      await revokeToken(t.id, tenant);
      setMsg(`已吊销令牌「${t.label}」`);
      await load();
    } catch (e: any) {
      setError(e?.response?.data?.detail || e.message || "吊销失败");
    }
  }

  const active = tokens.filter((t) => !t.revoked_at).length;

  return (
    <Layout
      title="API 令牌 API Tokens"
      subtitle="服务端访问凭证与权限范围"
      actions={<Button onClick={() => setCreateOpen(true)}><Plus className="h-4 w-4" /> 生成令牌</Button>}
    >
      <SubTabs tabs={TABS.map((t) => ({ ...t, active: t.label === "API 令牌" }))} />

      {error && <div className="mb-4 rounded-lg bg-red-50 px-4 py-2 text-sm text-red-600">{error}</div>}
      {msg && <div className="mb-4 rounded-lg bg-brand-50 px-4 py-2 text-sm text-brand-700">{msg}</div>}

      <Card className="p-2">
        {loading ? (
          <div className="flex justify-center py-12"><Spinner /></div>
        ) : (
          <DataTable
            columns={["名称", "令牌", "权限", "状态", "创建时间", "最近使用", ""]}
            rows={tokens.map((t) => ({
              名称: t.label,
              令牌: <code className="rounded bg-gray-100 px-1.5 py-0.5 text-xs">{t.prefix}…</code>,
              权限: t.scopes.length ? t.scopes.join(", ") : "—",
              状态: t.revoked_at
                ? <StatusPill tone="red">已吊销</StatusPill>
                : <StatusPill tone="green">活跃</StatusPill>,
              创建时间: t.created_at,
              最近使用: t.last_used || "—",
              "": t.revoked_at ? <span className="text-gray-300">—</span> : (
                <button className="inline-flex items-center gap-1 text-sm font-medium text-red-500 hover:text-red-600"
                  onClick={() => revoke(t)}>
                  <Trash2 className="h-3.5 w-3.5" /> 吊销
                </button>
              ),
            }))}
          />
        )}
        {!loading && tokens.length === 0 && (
          <div className="px-6 py-12 text-center text-sm text-gray-500">暂无令牌，点击右上角「生成令牌」创建。</div>
        )}
      </Card>

      <CreateTokenModal open={createOpen} onClose={() => setCreateOpen(false)} tenant={tenant}
        onDone={(text) => { setMsg(text); load(); }} />
    </Layout>
  );
}

const SCOPE_OPTIONS = ["read", "write", "admin", "segments", "objects", "etl"];

function CreateTokenModal({
  open, onClose, onDone, tenant,
}: { open: boolean; onClose: () => void; onDone: (msg: string) => void; tenant: number }) {
  const [label, setLabel] = useState("");
  const [scopes, setScopes] = useState<string[]>(["read"]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [plaintext, setPlaintext] = useState<string | null>(null);

  function toggle(s: string) {
    setScopes((prev) => prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]);
  }

  async function submit() {
    if (!label.trim()) { setErr("名称必填"); return; }
    setBusy(true); setErr(null);
    try {
      const r = await issueToken({ tenant_id: tenant, label: label.trim(), scopes });
      setPlaintext(r.token_plaintext);
      onDone(`已生成令牌「${r.label}」`);
    } catch (e: any) {
      setErr(e?.response?.data?.detail || e.message || "生成失败");
    } finally {
      setBusy(false);
    }
  }

  function close() {
    setLabel(""); setScopes(["read"]); setPlaintext(null); setErr(null);
    onClose();
  }

  return (
    <Modal open={open} title="生成 API 令牌" onClose={close}>
      {plaintext ? (
        <div className="space-y-4">
          <div className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-700 ring-1 ring-inset ring-amber-200">
            请立即复制并妥善保存，令牌明文仅显示这一次。
          </div>
          <code className="block break-all rounded-lg bg-gray-900 px-3 py-3 text-xs text-green-300">{plaintext}</code>
          <div className="flex items-center justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => navigator.clipboard?.writeText(plaintext)}>复制</Button>
            <Button onClick={close}>完成</Button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <TextField label="名称" value={label} onChange={setLabel} placeholder="如：数据同步服务" />
          <div>
            <span className="mb-1 block text-sm font-medium text-gray-700">权限范围</span>
            <div className="flex flex-wrap gap-2">
              {SCOPE_OPTIONS.map((s) => (
                <button key={s} type="button" onClick={() => toggle(s)}
                  className={`rounded-full px-3 py-1 text-xs font-medium ring-1 ring-inset ${
                    scopes.includes(s) ? "bg-brand-50 text-brand-700 ring-brand-200" : "bg-gray-50 text-gray-500 ring-gray-200"}`}>
                  {s}
                </button>
              ))}
            </div>
          </div>
          {err && <div className="text-sm text-red-600">{err}</div>}
          <div className="flex items-center justify-end gap-2 pt-2">
            <Button variant="outline" onClick={close}>取消</Button>
            <Button onClick={submit} disabled={busy}>{busy ? <Spinner /> : <KeyRound className="h-4 w-4" />} 生成</Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
