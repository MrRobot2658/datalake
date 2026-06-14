import { useCallback, useEffect, useState } from "react";
import { Plus, Play, Search, ShieldAlert } from "lucide-react";
import Layout from "../components/layout/Layout";
import { Card, DataTable, Button, Spinner, Badge, Modal, TextField } from "../components/ui";
import { StatCards } from "../components/segment/kit";
import { useTenant } from "../context/TenantContext";
import {
  listDeletionRequests,
  createDeletionRequest,
  executeDeletion,
  getDeletionRequest,
  checkSuppression,
  type DeletionRequest,
  type PrivacyAuditLog,
  type SuppressionResult,
} from "../api/privacy";

const TYPE_LABEL: Record<string, string> = { delete: "删除", suppress: "抑制", both: "删除+抑制" };
const STATUS: Record<string, { label: string; color: string }> = {
  pending: { label: "待处理", color: "amber" },
  processing: { label: "处理中", color: "brand" },
  completed: { label: "已完成", color: "green" },
};

export default function PrivacyDeletionPage() {
  const { tenant } = useTenant();
  const [reqs, setReqs] = useState<DeletionRequest[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<number | null>(null);

  // 新建工单
  const [open, setOpen] = useState(false);
  const [identifier, setIdentifier] = useState("");
  const [reason, setReason] = useState("");
  const [rtype, setRtype] = useState<"delete" | "suppress" | "both">("delete");
  const [saving, setSaving] = useState(false);

  // 工单详情
  const [detail, setDetail] = useState<(DeletionRequest & { audit_log: PrivacyAuditLog[] }) | null>(null);

  // 抑制校验
  const [supId, setSupId] = useState("");
  const [supRes, setSupRes] = useState<SuppressionResult | null>(null);
  const [supBusy, setSupBusy] = useState(false);

  const load = useCallback(() => {
    setReqs(null); setErr(null);
    listDeletionRequests(tenant).then((r) => setReqs(r.requests)).catch((e) => setErr(String(e)));
  }, [tenant]);

  useEffect(() => { load(); }, [load]);

  const save = async () => {
    if (!identifier.trim()) return;
    setSaving(true);
    try {
      await createDeletionRequest({
        tenant_id: tenant,
        identifier: identifier.trim(),
        request_type: rtype,
        reason: reason.trim() || undefined,
        created_by: "console",
      });
      setOpen(false); setIdentifier(""); setReason(""); setRtype("delete");
      load();
    } catch (e) { setErr(String(e)); }
    finally { setSaving(false); }
  };

  const execute = async (r: DeletionRequest) => {
    if (!window.confirm(`确认执行工单 #${r.request_id}？删除不可逆。`)) return;
    setBusy(r.request_id);
    try {
      await executeDeletion(tenant, r.request_id, true);
      load();
    } catch (e) { setErr(String(e)); }
    finally { setBusy(null); }
  };

  const view = async (r: DeletionRequest) => {
    try { setDetail(await getDeletionRequest(tenant, r.request_id)); }
    catch (e) { setErr(String(e)); }
  };

  const checkSup = async () => {
    if (!supId.trim()) return;
    setSupBusy(true); setSupRes(null);
    try {
      const idNum = Number(supId);
      const res = Number.isFinite(idNum) && String(idNum) === supId.trim()
        ? await checkSuppression(tenant, { one_id: idNum })
        : await checkSuppression(tenant, { identifier: supId.trim() });
      setSupRes(res);
    } catch (e) { setErr(String(e)); }
    finally { setSupBusy(false); }
  };

  return (
    <Layout
      title="删除与抑制 Deletion & Suppression"
      subtitle="处理 GDPR 删除/抑制工单，跟踪每个数据主体的执行回执（来自 /privacy/deletion）"
      actions={<Button onClick={() => setOpen(true)}><Plus className="h-4 w-4" /> 新建工单</Button>}
    >
      {err && <Card className="mb-4 p-4 text-sm text-red-600">{err}</Card>}

      <StatCards items={[
        { label: "工单总数", value: reqs ? reqs.length : "…" },
        { label: "待处理", value: reqs ? reqs.filter((r) => r.status === "pending").length : "…" },
        { label: "已完成", value: reqs ? reqs.filter((r) => r.status === "completed").length : "…" },
        { label: "影响记录数", value: reqs ? reqs.reduce((a, r) => a + (r.affected_count || 0), 0) : "…" },
      ]} />

      {!reqs && !err && <div className="flex items-center gap-2 text-gray-500"><Spinner /> 加载中…</div>}
      {reqs && (
        <Card className="mb-6 p-2">
          <div className="px-3 py-2 text-sm font-medium text-gray-700">删除/抑制工单</div>
          <DataTable
            columns={["工单ID", "标识符", "类型", "状态", "影响数", "提交时间", "操作"]}
            rows={reqs.map((r) => ({
              "工单ID": <button className="text-brand-600 hover:underline" onClick={() => view(r)}>#{r.request_id}</button>,
              "标识符": r.identifier || (r.one_id != null ? `one_id:${r.one_id}` : "—"),
              "类型": TYPE_LABEL[r.request_type] || r.request_type,
              "状态": <Badge color={STATUS[r.status]?.color || "gray"}>{STATUS[r.status]?.label || r.status}</Badge>,
              "影响数": r.affected_count ?? "—",
              "提交时间": r.created_at || "—",
              "操作": r.status === "completed" ? (
                <span className="text-xs text-gray-400">已执行</span>
              ) : (
                <Button variant="outline" onClick={() => execute(r)} disabled={busy === r.request_id}>
                  {busy === r.request_id ? <Spinner /> : <Play className="h-3.5 w-3.5" />} 执行
                </Button>
              ),
            }))}
          />
        </Card>
      )}

      {/* 抑制名单校验 */}
      <Card className="p-5">
        <div className="mb-3 flex items-center gap-2 text-sm font-medium text-gray-700">
          <ShieldAlert className="h-4 w-4 text-brand-500" /> 抑制名单校验
        </div>
        <div className="flex items-end gap-3">
          <div className="w-72">
            <TextField label="标识符 / OneID" value={supId} onChange={setSupId} placeholder="手机号、邮箱或 one_id" />
          </div>
          <Button variant="outline" onClick={checkSup} disabled={supBusy || !supId}>
            {supBusy ? <Spinner /> : <Search className="h-4 w-4" />} 校验
          </Button>
        </div>
        {supRes && (
          <div className="mt-4 text-sm">
            {supRes.suppressed ? (
              <div className="flex flex-wrap items-center gap-2">
                <Badge color="red">已抑制</Badge>
                {supRes.suppression_type && <span className="text-gray-600">类型：{supRes.suppression_type}</span>}
                {supRes.reason && <span className="text-gray-600">原因：{supRes.reason}</span>}
              </div>
            ) : (
              <div className="flex items-center gap-2"><Badge color="green">未抑制</Badge>
                {supRes.reason && <span className="text-gray-500">{supRes.reason}</span>}
              </div>
            )}
          </div>
        )}
      </Card>

      {/* 新建工单 */}
      <Modal open={open} title="新建删除/抑制工单" onClose={() => setOpen(false)}>
        <div className="space-y-4">
          <TextField label="数据主体标识符" value={identifier} onChange={setIdentifier} placeholder="手机号 / 邮箱 / 渠道ID" />
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-gray-700">工单类型</span>
            <select
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-400 focus:outline-none"
              value={rtype}
              onChange={(e) => setRtype(e.target.value as "delete" | "suppress" | "both")}
            >
              <option value="delete">删除（清理身份与画像数据）</option>
              <option value="suppress">抑制（加入抑制名单）</option>
              <option value="both">删除 + 抑制</option>
            </select>
          </label>
          <TextField label="原因" value={reason} onChange={setReason} placeholder="如 用户申请注销" />
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={() => setOpen(false)}>取消</Button>
            <Button onClick={save} disabled={saving || !identifier.trim()}>
              {saving ? <Spinner /> : "创建工单"}
            </Button>
          </div>
        </div>
      </Modal>

      {/* 工单详情 */}
      <Modal open={!!detail} title={detail ? `工单 #${detail.request_id} 详情` : ""} onClose={() => setDetail(null)}>
        {detail && (
          <div className="space-y-3 text-sm">
            <div className="grid grid-cols-2 gap-2">
              <Field k="标识符" v={detail.identifier || (detail.one_id != null ? `one_id:${detail.one_id}` : "—")} />
              <Field k="类型" v={TYPE_LABEL[detail.request_type] || detail.request_type} />
              <Field k="状态" v={STATUS[detail.status]?.label || detail.status} />
              <Field k="影响记录" v={detail.affected_count ?? "—"} />
              <Field k="提交时间" v={detail.created_at || "—"} />
              <Field k="执行时间" v={detail.executed_at || "—"} />
            </div>
            {detail.affected_tables && Object.keys(detail.affected_tables).length > 0 && (
              <div>
                <div className="mb-1 font-medium text-gray-700">影响表</div>
                <div className="rounded-lg bg-gray-50 p-2 font-mono text-xs text-gray-600">
                  {Object.entries(detail.affected_tables).map(([t, n]) => (
                    <div key={t}>{t}: {n}</div>
                  ))}
                </div>
              </div>
            )}
            <div>
              <div className="mb-1 font-medium text-gray-700">审计日志</div>
              {detail.audit_log.length === 0 ? (
                <div className="text-gray-400">暂无</div>
              ) : (
                <ul className="space-y-1">
                  {detail.audit_log.map((a) => (
                    <li key={a.audit_id} className="flex justify-between gap-2 text-xs text-gray-600">
                      <span>{a.operation_type}（影响 {a.affected_records}）</span>
                      <span className="text-gray-400">{a.created_at}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
      </Modal>
    </Layout>
  );
}

function Field({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs text-gray-400">{k}</div>
      <div className="text-gray-800">{v}</div>
    </div>
  );
}
