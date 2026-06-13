import { useEffect, useMemo, useState } from "react";
import { Plus, Search, Calculator, Sparkles, Code2, Save } from "lucide-react";
import { useTenant } from "../../context/TenantContext";
import { getMetadata, searchObjects, estimate, draftSegment, confirmSegment } from "../../api/client";
import type { DslRule, Metadata, Relation } from "../../api/types";
import { OBJECTS, byKey } from "../../lib/objects";
import { Card, Button, Badge, Spinner, DataTable, Modal, TextField } from "../ui";
import ConditionEditor, { type FieldOption } from "./ConditionEditor";
import RelationEditor from "./RelationEditor";

const searchableObjects = OBJECTS.filter((o) => o.kind === "object");

export default function UnifiedFilter({ baseObject, lockBase, autoSearch }: { baseObject?: string; lockBase?: boolean; autoSearch?: boolean }) {
  const { tenant } = useTenant();
  const [meta, setMeta] = useState<Metadata | null>(null);
  const [rule, setRule] = useState<DslRule>({
    object: baseObject || "user", logic: "AND", conditions: [], relations: [],
  });
  const [nl, setNl] = useState("");
  const [nlMsg, setNlMsg] = useState<{ kind: "info" | "warn"; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [est, setEst] = useState<{ n: number; ms: number; sql: string } | null>(null);
  const [rows, setRows] = useState<Record<string, any>[] | null>(null);
  const [showSql, setShowSql] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [saveOpen, setSaveOpen] = useState(false);
  const [saveCode, setSaveCode] = useState("");
  const [saveName, setSaveName] = useState("");
  const [saveMsg, setSaveMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  useEffect(() => {
    getMetadata(tenant).then(setMeta).catch((e) => setErr(String(e)));
  }, [tenant]);

  useEffect(() => {
    if (baseObject) setRule((r) => ({ ...r, object: baseObject }));
  }, [baseObject]);

  // 对象列表页：元数据就绪后自动拉一次默认明细
  useEffect(() => {
    if (autoSearch && meta) runSearch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoSearch, meta, baseObject, tenant]);

  const baseFields: FieldOption[] = useMemo(
    () => (meta?.objects.find((o) => o.object === rule.object)?.fields || []).map((f) => ({ code: f.code, type: f.type })),
    [meta, rule.object],
  );

  function patch(p: Partial<DslRule>) {
    setRule((r) => ({ ...r, ...p }));
    setEst(null);
  }

  async function runNL() {
    if (!nl.trim()) return;
    setBusy("nl"); setNlMsg(null); setErr(null);
    try {
      const d = await draftSegment(tenant, nl.trim());
      if (d.needs_clarification) {
        setNlMsg({ kind: "warn", text: "需要澄清：" + d.clarifications.join("；") });
      } else if (d.rule) {
        setRule({
          object: d.rule.object, logic: d.rule.logic || "AND",
          conditions: d.rule.conditions || [], relations: d.rule.relations || [],
        });
        setEst(d.estimate != null ? { n: d.estimate, ms: d.estimate_ms || 0, sql: "" } : null);
        setNlMsg({ kind: "info", text: `${d.summary || "已生成规则"}（来源 ${d.source}，置信度 ${d.confidence}）` });
      } else {
        setNlMsg({ kind: "warn", text: "未能生成规则，请更具体描述。" });
      }
    } catch (e: any) {
      setErr(e?.message || String(e));
    } finally {
      setBusy(null);
    }
  }

  async function runEstimate() {
    setBusy("est"); setErr(null);
    try {
      const r = await estimate(tenant, rule);
      setEst({ n: r.estimate, ms: r.elapsed_ms, sql: r.sql });
    } catch (e: any) {
      setErr(detail(e));
    } finally { setBusy(null); }
  }

  async function runSearch() {
    setBusy("search"); setErr(null);
    try {
      const r = await searchObjects({ tenant_id: tenant, object: rule.object, conditions: rule.conditions, relations: rule.relations, logic: rule.logic, limit: 50 });
      setRows(r.data || []);
      if (r.sql) setEst((e) => (e ? { ...e, sql: r.sql } : { n: r.row_count || 0, ms: r.elapsed_ms, sql: r.sql }));
    } catch (e: any) {
      setErr(detail(e));
    } finally { setBusy(null); }
  }

  async function runSave() {
    if (!saveCode.trim() || !saveName.trim()) {
      setSaveMsg({ kind: "err", text: "请填写群组编码和名称" });
      return;
    }
    setBusy("save"); setSaveMsg(null);
    try {
      await confirmSegment(tenant, saveCode.trim(), saveName.trim(), rule);
      setSaveMsg({ kind: "ok", text: `已保存群组「${saveName.trim()}」` });
      setTimeout(() => { setSaveOpen(false); setSaveMsg(null); setSaveCode(""); setSaveName(""); }, 1200);
    } catch (e: any) {
      setSaveMsg({ kind: "err", text: detail(e) });
    } finally { setBusy(null); }
  }

  if (err && !meta) return <Card className="p-6 text-sm text-red-600">加载元数据失败：{err}</Card>;
  if (!meta) return <div className="flex items-center gap-2 text-gray-500"><Spinner /> 加载中…</div>;

  return (
    <div className="space-y-5">
      {/* 自然语言 */}
      <Card className="p-5">
        <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-gray-800">
          <Sparkles className="h-4 w-4 text-brand-500" /> 自然语言圈人
        </div>
        <div className="flex gap-2">
          <input
            className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-400 focus:outline-none"
            placeholder="例：过去30天有过购买的用户 / 通过 app 渠道购买的用户"
            value={nl}
            onChange={(e) => setNl(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && runNL()}
          />
          <Button onClick={runNL} disabled={busy === "nl"}>
            {busy === "nl" ? <Spinner /> : <Sparkles className="h-4 w-4" />} 解析
          </Button>
        </div>
        {nlMsg && (
          <div className={`mt-3 rounded-lg px-3 py-2 text-sm ${nlMsg.kind === "warn" ? "bg-amber-50 text-amber-700" : "bg-brand-50 text-brand-700"}`}>
            {nlMsg.text}
          </div>
        )}
      </Card>

      {/* 筛选构建器 */}
      <Card className="p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-gray-800">筛选</span>
            <select
              disabled={lockBase}
              value={rule.object}
              onChange={(e) => patch({ object: e.target.value, conditions: [], relations: [] })}
              className="rounded-lg border border-gray-300 bg-white px-2.5 py-1.5 text-sm font-medium text-gray-700 disabled:bg-gray-100 focus:border-brand-400 focus:outline-none"
            >
              {searchableObjects.map((o) => (
                <option key={o.key} value={o.key}>{o.label}</option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={runEstimate} disabled={!!busy}>
              {busy === "est" ? <Spinner /> : <Calculator className="h-4 w-4" />} 预估人数
            </Button>
            <Button variant="outline" onClick={() => { setSaveMsg(null); setSaveOpen(true); }} disabled={!!busy}>
              <Save className="h-4 w-4" /> 存为群组
            </Button>
            <Button onClick={runSearch} disabled={!!busy}>
              {busy === "search" ? <Spinner /> : <Search className="h-4 w-4" />} 查询
            </Button>
          </div>
        </div>

        <div className="space-y-4">
          <div>
            <div className="mb-1 text-xs font-semibold text-gray-500">本对象条件（{byKey(rule.object)?.label}）</div>
            <ConditionEditor
              fieldOptions={baseFields}
              value={rule.conditions}
              onChange={(c) => patch({ conditions: c })}
              logic={rule.logic}
              onLogicChange={(l) => patch({ logic: l })}
              emptyHint="可不加 → 仅靠跨对象关联筛选"
            />
          </div>

          {rule.relations.map((rel, i) => (
            <RelationEditor
              key={i}
              meta={meta}
              source={rule.object}
              value={rel}
              onChange={(r) => patch({ relations: rule.relations.map((x, j) => (j === i ? r : x)) })}
              onRemove={() => patch({ relations: rule.relations.filter((_, j) => j !== i) })}
            />
          ))}

          <RelAddButton meta={meta} source={rule.object} onAdd={(r: Relation) => patch({ relations: [...rule.relations, r] })} />
        </div>
      </Card>

      {err && <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600">{err}</div>}

      {/* 预估结果 */}
      {est && (
        <Card className="flex flex-wrap items-center justify-between gap-3 p-5">
          <div className="flex items-baseline gap-3">
            <span className="text-sm text-gray-500">预估命中</span>
            <span className="text-3xl font-bold text-brand-600">{est.n}</span>
            <Badge color="green">{est.ms} ms</Badge>
          </div>
          {est.sql && (
            <button onClick={() => setShowSql((s) => !s)} className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-800">
              <Code2 className="h-4 w-4" /> {showSql ? "隐藏 SQL" : "查看 SQL"}
            </button>
          )}
        </Card>
      )}
      {est?.sql && showSql && (
        <Card className="overflow-x-auto p-4">
          <pre className="whitespace-pre-wrap break-all text-xs text-gray-600">{est.sql}</pre>
        </Card>
      )}

      {/* 明细 */}
      {rows && (
        <Card className="p-2">
          <div className="px-3 pb-2 pt-3 text-sm font-semibold text-gray-700">命中明细（最多 50 条）</div>
          <DataTable columns={rows[0] ? Object.keys(rows[0]).slice(0, 8) : ["结果"]} rows={rows} />
        </Card>
      )}

      {/* 存为群组 */}
      <Modal open={saveOpen} title="存为用户群组 / Segment" onClose={() => setSaveOpen(false)}>
        <div className="space-y-3">
          <div className="rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-500">
            基于当前筛选规则保存（base 对象：<b>{byKey(rule.object)?.label}</b>）。保存前会自动校验 + 预估人数。
          </div>
          <TextField label="群组编码（英文/数字/_/-）" value={saveCode} onChange={setSaveCode} placeholder="如 recent_buyers_30d" />
          <TextField label="群组名称" value={saveName} onChange={setSaveName} placeholder="如 近30天购买用户" />
          {saveMsg && (
            <div className={`rounded-lg px-3 py-2 text-sm ${saveMsg.kind === "ok" ? "bg-green-50 text-green-700" : "bg-red-50 text-red-600"}`}>
              {saveMsg.text}
            </div>
          )}
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="ghost" onClick={() => setSaveOpen(false)}>取消</Button>
            <Button onClick={runSave} disabled={busy === "save"}>
              {busy === "save" ? <Spinner /> : <Save className="h-4 w-4" />} 保存
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

function RelAddButton({ meta, source, onAdd }: { meta: Metadata; source: string; onAdd: (r: Relation) => void }) {
  const has = meta.relations.some((r) => r.src_type === source || r.dst_type === source);
  if (!has) return null;
  return (
    <button
      onClick={() => {
        const r = meta.relations.find((x) => x.src_type === source) || meta.relations.find((x) => x.dst_type === source)!;
        const forward = r.src_type === source;
        onAdd({ rel_type: r.rel_type, object: forward ? r.dst_type : r.src_type, direction: forward ? "forward" : "reverse", conditions: [], edge_conditions: [], relations: [] });
      }}
      className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-brand-300 px-3 py-2 text-sm font-medium text-brand-600 hover:bg-brand-50"
    >
      <Plus className="h-4 w-4" /> 添加跨对象关联（多条线）
    </button>
  );
}

function detail(e: any): string {
  const d = e?.response?.data?.detail;
  if (typeof d === "string") return d;
  if (d) return JSON.stringify(d);
  return e?.message || String(e);
}
