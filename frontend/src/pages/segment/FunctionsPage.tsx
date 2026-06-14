import { useEffect, useState } from "react";
import { FunctionSquare, Plus, Rocket } from "lucide-react";
import Layout from "../../components/layout/Layout";
import { Card, Button, Spinner, Modal, TextField, DataTable } from "../../components/ui";
import { StatCards, StatusPill, EmptyState } from "../../components/segment/kit";
import { useTenant } from "../../context/TenantContext";
import {
  listFunctions, createFunction, deployFunction, listFunctionRuns,
  type FunctionDef, type FunctionRun,
} from "../../api/connections";

const TYPE_OPTIONS = [
  { v: "source_function", label: "数据源函数" },
  { v: "destination_function", label: "目的地函数" },
];

export default function FunctionsPage() {
  const { tenant } = useTenant();
  const [items, setItems] = useState<FunctionDef[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState("");
  const [type, setType] = useState("source_function");
  const [code, setCode] = useState("async function onEvent(event) {\n  return event;\n}");
  const [runs, setRuns] = useState<FunctionRun[] | null>(null);
  const [activeFn, setActiveFn] = useState<FunctionDef | null>(null);

  function load() {
    setItems(null); setErr(null);
    listFunctions(tenant).then(setItems).catch((e) => setErr(String(e)));
  }
  useEffect(load, [tenant]);

  async function submit() {
    if (!name.trim()) return;
    setBusy(true); setErr(null);
    try {
      await createFunction(tenant, { function_name: name.trim(), function_type: type, language: "javascript", code });
      setName(""); setOpen(false); load();
    } catch (e) { setErr(String(e)); } finally { setBusy(false); }
  }

  async function deploy(fn: FunctionDef) {
    try { await deployFunction(tenant, fn.function_id); load(); }
    catch (e) { setErr(String(e)); }
  }

  async function openRuns(fn: FunctionDef) {
    setActiveFn(fn); setRuns(null);
    try { setRuns(await listFunctionRuns(tenant, fn.function_id)); }
    catch (e) { setErr(String(e)); setRuns([]); }
  }

  return (
    <Layout
      title="Functions"
      subtitle="用自定义代码在数据源 / 目的地侧转换数据"
      actions={<Button onClick={() => setOpen(true)}><Plus className="h-4 w-4" /> 新建 Function</Button>}
    >
      {items && (
        <StatCards items={[
          { label: "函数总数", value: items.length },
          { label: "已部署", value: items.filter((f) => f.status === "deployed").length },
          { label: "近7天执行", value: items.reduce((a, f) => a + (f.runs_7d || 0), 0).toLocaleString() },
          { label: "近7天错误", value: items.reduce((a, f) => a + (f.errors_7d || 0), 0) },
        ]} />
      )}

      {err && <Card className="mb-4 p-4 text-sm text-red-600">{err}</Card>}
      {!items && !err && <div className="flex items-center gap-2 text-gray-500"><Spinner /> 加载中…</div>}

      {items && items.length === 0 && (
        <EmptyState icon={FunctionSquare} title="还没有 Function" desc="用 JavaScript 编写自定义转换，部署后在数据源/目的地侧生效。"
          action={<Button onClick={() => setOpen(true)}><Plus className="h-4 w-4" /> 新建 Function</Button>} />
      )}

      {items && items.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((f) => (
            <Card key={f.function_id} className="flex h-full flex-col p-5">
              <div className="mb-3 flex items-center justify-between">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-50 text-brand-600">
                  <FunctionSquare className="h-5 w-5" />
                </div>
                <StatusPill tone={f.status === "deployed" ? "green" : "gray"}>{f.status}</StatusPill>
              </div>
              <div className="font-semibold text-gray-900">{f.function_name}</div>
              <div className="text-[11px] uppercase tracking-wide text-gray-400">{f.function_type} · {f.language}</div>
              <div className="mt-1 text-sm text-gray-500">近7天 {(f.runs_7d || 0).toLocaleString()} 次 · {f.errors_7d || 0} 错误</div>
              <div className="mt-4 flex gap-2">
                {f.status !== "deployed" && <Button variant="outline" onClick={() => deploy(f)}><Rocket className="h-4 w-4" /> 部署</Button>}
                <Button variant="ghost" onClick={() => openRuns(f)}>运行记录</Button>
              </div>
            </Card>
          ))}
        </div>
      )}

      <Modal open={open} title="新建 Function" onClose={() => setOpen(false)}>
        <div className="space-y-4">
          <TextField label="名称" value={name} onChange={setName} placeholder="如：邮箱脱敏 / 事件富化" />
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-gray-700">类型</span>
            <select className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-400 focus:outline-none"
              value={type} onChange={(e) => setType(e.target.value)}>
              {TYPE_OPTIONS.map((t) => <option key={t.v} value={t.v}>{t.label}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-gray-700">代码 (JavaScript)</span>
            <textarea className="h-32 w-full rounded-lg border border-gray-300 px-3 py-2 font-mono text-xs focus:border-brand-400 focus:outline-none"
              value={code} onChange={(e) => setCode(e.target.value)} />
          </label>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setOpen(false)}>取消</Button>
            <Button onClick={submit} disabled={busy || !name.trim()}>
              {busy ? <Spinner /> : <Plus className="h-4 w-4" />} 创建
            </Button>
          </div>
        </div>
      </Modal>

      <Modal open={!!activeFn} title={`运行记录 · ${activeFn?.function_name || ""}`} onClose={() => setActiveFn(null)}>
        {!runs && <div className="flex items-center gap-2 text-gray-500"><Spinner /> 加载中…</div>}
        {runs && (
          <DataTable
            columns={["时间", "状态", "耗时", "内存"]}
            rows={runs.map((r) => ({
              时间: r.created_at, 状态: r.status,
              耗时: r.duration_ms != null ? `${r.duration_ms}ms` : "—",
              内存: r.memory_mb != null ? `${r.memory_mb}MB` : "—",
            }))}
          />
        )}
      </Modal>
    </Layout>
  );
}
