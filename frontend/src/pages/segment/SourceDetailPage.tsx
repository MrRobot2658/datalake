import { useEffect, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { Link, useParams } from "react-router-dom";
import Layout from "../../components/layout/Layout";
import { Badge, Card, DataTable, Spinner, Button } from "../../components/ui";
import { StatCards } from "../../components/segment/kit";
import { getSource, listSourceEvents, type SourceDetail, type SourceEvent } from "../../api/connections";
import { useTenant } from "../../context/TenantContext";

export default function SourceDetailPage() {
  const { id = "" } = useParams();
  const { tenant } = useTenant();
  const [src, setSrc] = useState<SourceDetail | null>(null);
  const [events, setEvents] = useState<SourceEvent[]>([]);
  const [err, setErr] = useState<string | null>(null);

  function loadEvents() {
    listSourceEvents(tenant, id, 50).then(setEvents).catch(() => {});
  }

  useEffect(() => {
    setSrc(null); setErr(null);
    getSource(tenant, id)
      .then((s) => { setSrc(s); setEvents(s.recent_events || []); })
      .catch((e) => setErr(String(e)));
  }, [tenant, id]);

  const schemaEvents = src ? Array.from(new Set((src.recent_events || []).map((e) => e.event_type))) : [];
  const rows = events.map((r) => ({
    时间: r.timestamp || r.created_at,
    事件: r.event_type,
    anonymousId: r.anonymousId,
    状态: r.status,
  }));

  return (
    <Layout
      title={src ? `${src.source_name} · 数据源详情` : "数据源详情"}
      subtitle="实时事件、Schema 与 Debugger"
      actions={
        <Link to="/connections" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-800">
          <ArrowLeft className="h-4 w-4" /> 返回连接
        </Link>
      }
    >
      {err && <Card className="p-5 text-sm text-red-600">{err}</Card>}
      {!src && !err && <div className="flex items-center gap-2 text-gray-500"><Spinner /> 加载中…</div>}

      {src && (
        <>
          <StatCards items={[
            { label: "近24h事件", value: (src.event_count_24h || 0).toLocaleString() },
            { label: "类型", value: src.source_type },
            { label: "状态", value: src.status },
            { label: "Write Key", value: <span className="font-mono text-base">{src.write_key || "—"}</span> },
          ]} />

          <Card className="mb-6 p-5">
            <div className="mb-3 text-sm font-semibold text-gray-900">Schema 事件</div>
            <div className="flex flex-wrap gap-2">
              {schemaEvents.length === 0 && <span className="text-sm text-gray-400">暂无事件</span>}
              {schemaEvents.map((e) => <Badge key={e} color="brand">{e}</Badge>)}
            </div>
          </Card>

          <div className="mb-2 flex items-center justify-between">
            <div className="text-sm font-semibold text-gray-900">实时事件 (Debugger)</div>
            <Button variant="outline" onClick={loadEvents}>刷新</Button>
          </div>
          <DataTable columns={["时间", "事件", "anonymousId", "状态"]} rows={rows} />
        </>
      )}
    </Layout>
  );
}
