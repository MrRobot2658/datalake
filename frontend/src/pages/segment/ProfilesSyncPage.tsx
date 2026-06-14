import { useState } from "react";
import { Cloud, RefreshCw } from "lucide-react";
import Layout from "../../components/layout/Layout";
import { Card, Button, DataTable, Modal, TextField, Spinner } from "../../components/ui";
import { useTenant } from "../../context/TenantContext";
import { syncProfiles, type ProfileSyncInput, type ProfileSyncResult } from "../../api/unify";

const EMPTY: ProfileSyncInput = {
  job_name: "profile-sync", target_warehouse: "doris_dw",
  source_object: "doris_user_wide", tables: ["doris_user_wide"], schedule: "0 */15 * * * *",
};

export default function ProfilesSyncPage() {
  const { tenant } = useTenant();
  const [runs, setRuns] = useState<ProfileSyncResult[]>([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<ProfileSyncInput>(EMPTY);
  const [tablesText, setTablesText] = useState("doris_user_wide");
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  async function run() {
    if (!form.target_warehouse.trim()) { setError("请填写目标数仓"); return; }
    setRunning(true); setError(null); setMsg(null);
    try {
      const r = await syncProfiles(tenant, {
        ...form,
        tables: tablesText.split(",").map((s) => s.trim()).filter(Boolean),
      });
      setMsg(`同步完成：job ${r.job_id} 写入 ${r.row_count} 行 → ${r.target_warehouse}`);
      setRuns((prev) => [r, ...prev]);
      setOpen(false);
    } catch (e: any) {
      setError(e?.response?.data?.detail || e.message || "同步失败");
    } finally {
      setRunning(false);
    }
  }

  return (
    <Layout
      title="档案同步 Profiles Sync"
      subtitle="将统一档案持续同步回数据仓库，供下游分析使用（Reverse-ETL）"
      actions={<Button onClick={() => { setForm(EMPTY); setTablesText("doris_user_wide"); setError(null); setOpen(true); }}>
        <RefreshCw className="h-4 w-4" /> 新建同步并执行
      </Button>}
    >
      {error && <div className="mb-4 rounded-lg bg-red-50 px-4 py-2 text-sm text-red-600">{error}</div>}
      {msg && <div className="mb-4 rounded-lg bg-brand-50 px-4 py-2 text-sm text-brand-700">{msg}</div>}

      <Card className="p-2">
        {runs.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-6 py-16 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-brand-50 text-brand-600">
              <Cloud className="h-6 w-6" />
            </div>
            <div className="font-semibold text-gray-900">尚无同步记录</div>
            <div className="max-w-sm text-sm text-gray-500">配置目标数仓与要回流的特征/标签表，点击执行将用户宽表同步至下游。</div>
            <Button className="mt-2" onClick={() => setOpen(true)}>
              <RefreshCw className="h-4 w-4" /> 新建同步并执行
            </Button>
          </div>
        ) : (
          <DataTable
            columns={["任务", "运行", "目标数仓", "同步表", "行数", "状态"]}
            rows={runs.map((r) => ({
              "任务": r.job_id,
              "运行": r.run_id,
              "目标数仓": r.target_warehouse,
              "同步表": (r.tables || []).join(", ") || "—",
              "行数": r.row_count,
              "状态": r.status,
            }))}
          />
        )}
      </Card>

      <Modal open={open} title="新建档案同步" onClose={() => setOpen(false)}>
        <div className="space-y-3">
          <TextField label="任务名" value={form.job_name ?? ""}
            onChange={(v) => setForm({ ...form, job_name: v })} />
          <TextField label="目标数仓 / warehouse_id" value={form.target_warehouse}
            placeholder="doris_dw" onChange={(v) => setForm({ ...form, target_warehouse: v })} />
          <TextField label="源对象表" value={form.source_object ?? ""}
            onChange={(v) => setForm({ ...form, source_object: v })} />
          <TextField label="同步表（逗号分隔）" value={tablesText} onChange={setTablesText} />
          <TextField label="调度 cron（可选）" value={form.schedule ?? ""}
            placeholder="0 */15 * * * *" onChange={(v) => setForm({ ...form, schedule: v })} />
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setOpen(false)}>取消</Button>
            <Button onClick={run} disabled={running}>
              {running ? <Spinner /> : "执行同步"}
            </Button>
          </div>
        </div>
      </Modal>
    </Layout>
  );
}
