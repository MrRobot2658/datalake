import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  FileSpreadsheet, Database, Radio, Cloud, Plus, ArrowRight, Workflow, KeyRound, Copy,
} from "lucide-react";
import Layout from "../components/layout/Layout";
import { Card, Button, Spinner, Modal, TextField } from "../components/ui";
import { StatCards, StatusPill, EmptyState } from "../components/segment/kit";
import { useTenant } from "../context/TenantContext";
import { listSources, createSource, type Source } from "../api/connections";

// 数据源类型目录（对标 Segment Connections › Sources Catalog）。
const TYPE_META: Record<string, { icon: typeof FileSpreadsheet; label: string }> = {
  csv: { icon: FileSpreadsheet, label: "CSV / 粘贴" },
  mysql: { icon: Database, label: "MySQL" },
  kafka: { icon: Radio, label: "Kafka" },
  api: { icon: Cloud, label: "REST API" },
  javascript: { icon: Cloud, label: "JavaScript" },
};
const TYPE_OPTIONS = ["csv", "mysql", "kafka", "api", "javascript"];

function statusTone(s: string) {
  if (s === "active") return "green" as const;
  if (s === "paused" || s === "disabled") return "gray" as const;
  return "amber" as const;
}

export default function ConnectionsPage() {
  const { tenant } = useTenant();
  const [sources, setSources] = useState<Source[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [type, setType] = useState("csv");
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<{ source_id: string; write_key: string } | null>(null);

  function load() {
    setSources(null); setErr(null);
    listSources(tenant).then(setSources).catch((e) => setErr(String(e)));
  }
  useEffect(load, [tenant]);

  async function submit() {
    if (!name.trim()) return;
    setBusy(true); setErr(null);
    try {
      const r = await createSource(tenant, { source_name: name.trim(), source_type: type });
      setCreated({ source_id: r.source_id, write_key: r.write_key });
      setName("");
      load();
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Layout
      title="数据源 Sources"
      subtitle="把数据接入 CDP —— 一次接入，导入任意对象（Track once, send everywhere）"
      actions={
        <>
          <Link to="/connections/flow">
            <Button variant="outline"><Workflow className="h-4 w-4" /> 可视化编排</Button>
          </Link>
          <Button onClick={() => { setCreated(null); setOpen(true); }}>
            <Plus className="h-4 w-4" /> 添加数据源
          </Button>
        </>
      }
    >
      {sources && (
        <StatCards items={[
          { label: "数据源总数", value: sources.length },
          { label: "活跃", value: sources.filter((s) => s.status === "active").length },
          { label: "近24h事件", value: sources.reduce((a, s) => a + (s.event_count_24h || 0), 0).toLocaleString() },
          { label: "类型", value: new Set(sources.map((s) => s.source_type)).size },
        ]} />
      )}

      {err && <Card className="mb-4 p-4 text-sm text-red-600">{err}</Card>}
      {!sources && !err && <div className="flex items-center gap-2 text-gray-500"><Spinner /> 加载中…</div>}

      {sources && sources.length === 0 && (
        <EmptyState
          icon={FileSpreadsheet}
          title="还没有数据源"
          desc="添加一个数据源开始接入数据，或用可视化 ETL 直接导入 CSV。"
          action={
            <div className="flex gap-2">
              <Button onClick={() => { setCreated(null); setOpen(true); }}><Plus className="h-4 w-4" /> 添加数据源</Button>
              <Link to="/connections/sources/new"><Button variant="outline">CSV 导入</Button></Link>
            </div>
          }
        />
      )}

      {sources && sources.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {sources.map((s) => {
            const meta = TYPE_META[s.source_type] || { icon: Cloud, label: s.source_type };
            return (
              <Link key={s.source_id} to={`/connections/sources/${s.source_id}`}>
                <Card className="flex h-full flex-col p-5 transition-shadow hover:shadow-md">
                  <div className="mb-3 flex items-center justify-between">
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-50 text-brand-600">
                      <meta.icon className="h-5 w-5" />
                    </div>
                    <StatusPill tone={statusTone(s.status)}>{s.status}</StatusPill>
                  </div>
                  <div className="font-semibold text-gray-900">{s.source_name}</div>
                  <div className="text-[11px] uppercase tracking-wide text-gray-400">{meta.label}</div>
                  <div className="mt-2 text-sm text-gray-500">
                    近24h <span className="font-medium text-gray-700">{(s.event_count_24h || 0).toLocaleString()}</span> 事件
                  </div>
                  <div className="mt-4 flex items-center gap-1 text-sm font-medium text-brand-600">
                    查看详情 <ArrowRight className="h-4 w-4" />
                  </div>
                </Card>
              </Link>
            );
          })}
        </div>
      )}

      <Modal open={open} title={created ? "数据源已创建" : "添加数据源"} onClose={() => setOpen(false)}>
        {created ? (
          <div className="space-y-4">
            <div className="rounded-lg bg-amber-50 p-3 text-sm text-amber-700">
              <div className="mb-1 flex items-center gap-1 font-medium"><KeyRound className="h-4 w-4" /> Write Key（仅此一次完整展示）</div>
              <div className="flex items-center gap-2">
                <code className="flex-1 break-all rounded bg-white px-2 py-1 font-mono text-xs">{created.write_key}</code>
                <button
                  className="rounded p-1 text-amber-700 hover:bg-amber-100"
                  onClick={() => navigator.clipboard?.writeText(created.write_key)}
                  title="复制"
                ><Copy className="h-4 w-4" /></button>
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Link to={`/connections/sources/${created.source_id}`}><Button>查看详情</Button></Link>
              <Button variant="outline" onClick={() => setOpen(false)}>关闭</Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <TextField label="名称" value={name} onChange={setName} placeholder="如：官网埋点 / 业务库订单" />
            <label className="block">
              <span className="mb-1 block text-sm font-medium text-gray-700">类型</span>
              <select
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-400 focus:outline-none"
                value={type}
                onChange={(e) => setType(e.target.value)}
              >
                {TYPE_OPTIONS.map((t) => <option key={t} value={t}>{TYPE_META[t]?.label || t}</option>)}
              </select>
            </label>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setOpen(false)}>取消</Button>
              <Button onClick={submit} disabled={busy || !name.trim()}>
                {busy ? <Spinner /> : <Plus className="h-4 w-4" />} 创建
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </Layout>
  );
}
