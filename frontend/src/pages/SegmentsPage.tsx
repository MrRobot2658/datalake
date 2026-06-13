import { useEffect, useState } from "react";
import Layout from "../components/layout/Layout";
import { Card, DataTable, Spinner, Badge } from "../components/ui";
import { listSegments } from "../api/client";
import { useTenant } from "../context/TenantContext";

export default function SegmentsPage() {
  const { tenant } = useTenant();
  const [rows, setRows] = useState<any[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setRows(null); setErr(null);
    listSegments(tenant).then(setRows).catch((e) => setErr(String(e)));
  }, [tenant]);

  const cols = rows?.[0]
    ? Object.keys(rows[0]).filter((k) => k !== "dsl").slice(0, 8)
    : ["segment_code"];

  return (
    <Layout title="用户群组">
      <div className="mb-5 flex items-center gap-2">
        <p className="text-sm text-gray-500">已保存的人群包 / Segment（来自 /segments）</p>
        {rows && <Badge color="brand">{rows.length} 个</Badge>}
      </div>
      {err && <Card className="p-5 text-sm text-red-600">{err}</Card>}
      {!rows && !err && <div className="flex items-center gap-2 text-gray-500"><Spinner /> 加载中…</div>}
      {rows && (
        <Card className="p-2">
          <DataTable columns={cols} rows={rows} />
        </Card>
      )}
    </Layout>
  );
}
