import { useEffect, useState } from "react";
import { Plus, Play, RefreshCw } from "lucide-react";
import Layout from "../../components/layout/Layout";
import { Card, DataTable, Spinner, Button, Modal, TextField } from "../../components/ui";
import { StatCards, EmptyState } from "../../components/segment/kit";
import { useTenant } from "../../context/TenantContext";
import {
  listReverseEtlJobs, createReverseEtlJob, runReverseEtlNow, listReverseEtlRuns,
  listDestinations, type ReverseEtlJob, type ReverseEtlRun, type Destination,
} from "../../api/connections";

const SOURCE_OBJECTS = ["user", "account", "order", "product", "store", "lead"];

export default function ReverseEtlPage() {
  const { tenant } = useTenant();
  const [jobs, setJobs] = useState<ReverseEtlJob[] | null>(null);
  const [dests, setDests] = useState<Destination[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState("");
  const [obj, setObj] = useState("user");
  const [destId, setDestId] = useState("");
  const [cron, setCron] = useState("0 */15 * * * *");
  const [runs, setRuns] = useState<ReverseEtlRun[] | null>(null);
  const [activeJob, setActiveJob] = useState<ReverseEtlJob | null>(null);

  function load() {
    setJobs(null); setErr(null);
    listReverseEtlJobs(tenant).then(setJobs).catch((e) => setErr(String(e)));
    listDestinations(tenant).then((d) => { setDests(d); if (d[0]) setDestId(d[0].destination_id); }).catch(() => {});
  }
  useEffect(load, [tenant]);

  async function submit() {
    if (!name.trim() || !destId) return;
    setBusy(true); setErr(null);
    try {
      await createReverseEtlJob(tenant, { job_name: name.trim(), source_object: obj, destination_id: destId, schedule_cron: cron });
      setName(""); setOpen(false); load();
    } catch (e) { setErr(String(e)); } finally { setBusy(false); }
  }

  async function runNow(job: ReverseEtlJob) {
    try { await runReverseEtlNow(tenant, job.job_id); load(); openRuns(job); }
    catch (e) { setErr(String(e)); }
  }

  async function openRuns(job: ReverseEtlJob) {
    setActiveJob(job); setRuns(null);
    try { setRuns(await listReverseEtlRuns(tenant, job.job_id)); }
    catch (e) { setErr(String(e)); setRuns([]); }
  }

  const rows = (jobs || []).map((j) => ({
    任务: j.job_name,
    源对象: j.source_object,
    调度: j.schedule_cron,
    启用: j.enabled ? "是" : "否",
    状态: j.last_status || "—",
    _job: j,
  }));

  return (
    <Layout
      title="反向 ETL Reverse ETL"
      subtitle="将统一对象/数仓宽表按调度反向同步到目的地"
      actions={<Button onClick={() => setOpen(true)} disabled={dests.length === 0}><Plus className="h-4 w-4" /> 新建任务</Button>}
    >
      {jobs && (
        <StatCards items={[
          { label: "任务总数", value: jobs.length },
          { label: "已启用", value: jobs.filter((j) => j.enabled).length },
          { label: "目的地", value: dests.length },
          { label: "运行中", value: jobs.filter((j) => j.last_status === "running" || j.last_status === "pending").length },
        ]} />
      )}

      {err && <Card className="mb-4 p-4 text-sm text-red-600">{err}</Card>}
      {!jobs && !err && <div className="flex items-center gap-2 text-gray-500"><Spinner /> 加载中…</div>}

      {jobs && jobs.length === 0 && (
        <EmptyState icon={RefreshCw} title="还没有反向 ETL 任务"
          desc={dests.length === 0 ? "请先在「目的地」创建一个目的地，再来新建反向同步任务。" : "新建一个任务，把对象数据按调度同步到目的地。"}
          action={dests.length > 0 ? <Button onClick={() => setOpen(true)}><Plus className="h-4 w-4" /> 新建任务</Button> : undefined} />
      )}

      {jobs && jobs.length > 0 && (
        <Card className="p-2">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wider text-gray-400">
                {["任务", "源对象", "调度", "启用", "状态", "操作"].map((c) => <th key={c} className="px-4 py-3 font-semibold">{c}</th>)}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.map((r, i) => (
                <tr key={i} className="hover:bg-gray-50">
                  <td className="px-4 py-3 text-gray-800">{r.任务}</td>
                  <td className="px-4 py-3 text-gray-700">{r.源对象}</td>
                  <td className="px-4 py-3 font-mono text-xs text-gray-600">{r.调度}</td>
                  <td className="px-4 py-3 text-gray-700">{r.启用}</td>
                  <td className="px-4 py-3 text-gray-700">{r.状态}</td>
                  <td className="px-4 py-3">
                    <div className="flex gap-2">
                      <Button variant="outline" onClick={() => runNow(r._job)}><Play className="h-4 w-4" /> 立即运行</Button>
                      <Button variant="ghost" onClick={() => openRuns(r._job)}>运行记录</Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      <Modal open={open} title="新建反向 ETL 任务" onClose={() => setOpen(false)}>
        <div className="space-y-4">
          <TextField label="任务名称" value={name} onChange={setName} placeholder="如：高价值客户回流广告平台" />
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-gray-700">源对象</span>
            <select className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-400 focus:outline-none"
              value={obj} onChange={(e) => setObj(e.target.value)}>
              {SOURCE_OBJECTS.map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-gray-700">目的地</span>
            <select className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-400 focus:outline-none"
              value={destId} onChange={(e) => setDestId(e.target.value)}>
              {dests.map((d) => <option key={d.destination_id} value={d.destination_id}>{d.destination_name}</option>)}
            </select>
          </label>
          <TextField label="调度 (cron)" value={cron} onChange={setCron} placeholder="0 */15 * * * *" />
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setOpen(false)}>取消</Button>
            <Button onClick={submit} disabled={busy || !name.trim() || !destId}>
              {busy ? <Spinner /> : <Plus className="h-4 w-4" />} 创建
            </Button>
          </div>
        </div>
      </Modal>

      <Modal open={!!activeJob} title={`运行记录 · ${activeJob?.job_name || ""}`} onClose={() => setActiveJob(null)}>
        {!runs && <div className="flex items-center gap-2 text-gray-500"><Spinner /> 加载中…</div>}
        {runs && (
          <DataTable
            columns={["开始时间", "行数", "耗时", "状态"]}
            rows={runs.map((r) => ({
              开始时间: r.start_time, 行数: r.row_count, 耗时: r.duration_ms != null ? `${r.duration_ms}ms` : "—", 状态: r.status,
            }))}
          />
        )}
      </Modal>
    </Layout>
  );
}
