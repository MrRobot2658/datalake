import { useCallback, useEffect, useState } from "react";
import { ScanSearch, ShieldCheck } from "lucide-react";
import Layout from "../components/layout/Layout";
import { Card, DataTable, Button, Spinner, Badge } from "../components/ui";
import { StatCards, EmptyState } from "../components/segment/kit";
import { useTenant } from "../context/TenantContext";
import {
  listPiiRules,
  scanPii,
  createPiiRule,
  deletePiiRule,
  updatePiiRule,
  type PiiRule,
  type PiiDetectedField,
  type PiiAction,
} from "../api/privacy";

const ACTION_LABEL: Record<string, string> = {
  hash: "哈希", block: "阻断", allow: "明文放行", mask: "掩码", drop: "丢弃", encrypt: "加密",
};
const ACTION_COLOR: Record<string, string> = {
  hash: "brand", block: "red", allow: "gray", mask: "amber", drop: "red", encrypt: "brand",
};

export default function PrivacyDataControlsPage() {
  const { tenant } = useTenant();
  const [rules, setRules] = useState<PiiRule[] | null>(null);
  const [detected, setDetected] = useState<PiiDetectedField[] | null>(null);
  const [scanning, setScanning] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(() => {
    setRules(null); setErr(null);
    listPiiRules(tenant).then(setRules).catch((e) => setErr(String(e)));
  }, [tenant]);

  useEffect(() => { load(); setDetected(null); }, [load]);

  const runScan = async () => {
    setScanning(true); setErr(null);
    try {
      const r = await scanPii({ tenant_id: tenant, scan_depth: "all" });
      setDetected(r.detected_fields);
    } catch (e) { setErr(String(e)); }
    finally { setScanning(false); }
  };

  const govern = async (f: PiiDetectedField) => {
    setBusy(`scan:${f.field}`);
    try {
      await createPiiRule({
        tenant_id: tenant,
        field_name: f.field,
        category: f.category,
        action: f.suggested_action as PiiAction,
        scope: "全局",
        target_objects: f.object ? [f.object] : undefined,
        created_by: "console",
      });
      await runScan();
      load();
    } catch (e) { setErr(String(e)); }
    finally { setBusy(null); }
  };

  const toggle = async (r: PiiRule) => {
    setBusy(`rule:${r.rule_id}`);
    try {
      if (r.is_active) await deletePiiRule(tenant, r.rule_id);
      else await updatePiiRule(tenant, r.rule_id, { is_active: 1 });
      load();
    } catch (e) { setErr(String(e)); }
    finally { setBusy(null); }
  };

  const active = (rules || []).filter((r) => r.is_active);

  return (
    <Layout
      title="数据管控 Data Controls"
      subtitle="检测与管控 PII / 敏感字段，按字段配置哈希、阻断或明文动作（来自 /privacy/pii）"
      actions={
        <Button onClick={runScan} disabled={scanning}>
          {scanning ? <Spinner /> : <ScanSearch className="h-4 w-4" />} 扫描 PII
        </Button>
      }
    >
      {err && <Card className="mb-4 p-4 text-sm text-red-600">{err}</Card>}

      <StatCards items={[
        { label: "受管字段", value: rules ? active.length : "…" },
        { label: "阻断动作", value: rules ? active.filter((r) => r.action === "block").length : "…" },
        { label: "明文放行", value: rules ? active.filter((r) => r.action === "allow").length : "…" },
        { label: "已禁用规则", value: rules ? (rules.length - active.length) : "…" },
      ]} />

      {/* 扫描结果 */}
      {detected && (
        <Card className="mb-6 p-2">
          <div className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-gray-700">
            <ScanSearch className="h-4 w-4 text-brand-500" /> 扫描结果 · 命中 {detected.length} 个疑似字段
          </div>
          <DataTable
            columns={["对象", "字段", "类别", "置信度", "建议动作", "状态", "操作"]}
            rows={detected.map((f) => ({
              "对象": f.object,
              "字段": f.field,
              "类别": f.category,
              "置信度": `${Math.round(f.confidence * 100)}%`,
              "建议动作": <Badge color={ACTION_COLOR[f.suggested_action] || "gray"}>{ACTION_LABEL[f.suggested_action] || f.suggested_action}</Badge>,
              "状态": f.already_governed
                ? <Badge color="green">已管控</Badge>
                : <Badge color="amber">未管控</Badge>,
              "操作": f.already_governed ? (
                <span className="text-xs text-gray-400">—</span>
              ) : (
                <Button variant="outline" onClick={() => govern(f)} disabled={busy === `scan:${f.field}`}>
                  {busy === `scan:${f.field}` ? <Spinner /> : <ShieldCheck className="h-3.5 w-3.5" />} 管控
                </Button>
              ),
            }))}
          />
        </Card>
      )}

      {/* 管控规则 */}
      {!rules && !err && <div className="flex items-center gap-2 text-gray-500"><Spinner /> 加载中…</div>}
      {rules && rules.length === 0 && (
        <EmptyState
          icon={ShieldCheck}
          title="暂无 PII 管控规则"
          desc="点击右上角「扫描 PII」自动发现敏感字段，并一键加入管控。"
        />
      )}
      {rules && rules.length > 0 && (
        <Card className="p-2">
          <div className="px-3 py-2 text-sm font-medium text-gray-700">管控规则</div>
          <DataTable
            columns={["字段", "类别", "动作", "范围", "适用对象", "状态", "操作"]}
            rows={rules.map((r) => ({
              "字段": r.field_name,
              "类别": r.category || "—",
              "动作": <Badge color={ACTION_COLOR[r.action] || "gray"}>{ACTION_LABEL[r.action] || r.action}</Badge>,
              "范围": r.scope || "全局",
              "适用对象": (r.target_objects && r.target_objects.length) ? r.target_objects.join(", ") : "全部",
              "状态": r.is_active ? <Badge color="green">启用</Badge> : <Badge color="gray">禁用</Badge>,
              "操作": (
                <Button variant="outline" onClick={() => toggle(r)} disabled={busy === `rule:${r.rule_id}`}>
                  {busy === `rule:${r.rule_id}` ? <Spinner /> : (r.is_active ? "禁用" : "启用")}
                </Button>
              ),
            }))}
          />
        </Card>
      )}
    </Layout>
  );
}
