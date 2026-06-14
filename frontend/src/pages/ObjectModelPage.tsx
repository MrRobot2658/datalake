import { useEffect, useMemo, useState } from "react";
import { Boxes, Plus, Pencil, Trash2, GitBranch, Lock } from "lucide-react";
import Layout from "../components/layout/Layout";
import { Card, DataTable, Spinner, Button, Modal, TextField, Badge } from "../components/ui";
import { StatCards } from "../components/segment/kit";
import { useTenant } from "../context/TenantContext";
import { byKey } from "../lib/objects";
import {
  getDefinitions, createObject, addField, patchField,
  createRelation, deleteRelation,
  type ObjectDefinitions, type ObjectDefinition, type ObjectFieldDef,
} from "../api/objects";

const FIELD_TYPES = ["str", "int", "float", "datetime", "json", "json_array"];
const TYPE_LABEL: Record<string, string> = {
  str: "文本", int: "整数", float: "小数", datetime: "时间",
  json: "JSON", json_array: "JSON 数组",
};
const objLabel = (k: string) => byKey(k)?.label ?? k;

// 原生下拉，样式与 TextField 对齐
function SelectField({ label, value, onChange, options }: {
  label: string; value: string; onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-gray-700">{label}</span>
      <select
        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-400 focus:outline-none"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </label>
  );
}

export default function ObjectModelPage() {
  const { tenant } = useTenant();
  const [defs, setDefs] = useState<ObjectDefinitions | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // 弹窗状态
  const [newObj, setNewObj] = useState(false);
  const [addFieldFor, setAddFieldFor] = useState<string | null>(null);
  const [editField, setEditField] = useState<{ obj: string; field: ObjectFieldDef } | null>(null);
  const [newRel, setNewRel] = useState(false);

  const reload = () => {
    setErr(null);
    getDefinitions(tenant).then(setDefs).catch((e) => setErr(String(e)));
  };
  useEffect(() => { setDefs(null); reload(); /* eslint-disable-next-line */ }, [tenant]);

  const objectKeys = useMemo(() => (defs?.objects ?? []).map((o) => o.object), [defs]);
  const fieldTotal = useMemo(
    () => (defs?.objects ?? []).reduce((n, o) => n + (o.fields?.length ?? 0), 0),
    [defs],
  );

  return (
    <Layout
      title="对象模型 Data Model"
      subtitle="管理对象定义、字段与跨对象关系 —— DSL 校验 / ETL / 筛选器均以此为单一事实源"
      actions={
        <>
          <Button variant="outline" onClick={() => setNewRel(true)} disabled={!defs}>
            <GitBranch className="h-4 w-4" /> 新建关系
          </Button>
          <Button onClick={() => setNewObj(true)}>
            <Plus className="h-4 w-4" /> 新建对象
          </Button>
        </>
      }
    >
      {err && <Card className="mb-4 p-5 text-sm text-red-600">{err}</Card>}
      {!defs && !err && <div className="flex items-center gap-2 text-gray-500"><Spinner /> 加载中…</div>}

      {defs && (
        <>
          <StatCards items={[
            { label: "对象数", value: defs.objects.length },
            { label: "字段总数", value: fieldTotal },
            { label: "关系数", value: defs.relations.length },
            { label: "租户", value: tenant },
          ]} />

          {/* 对象与字段 */}
          <div className="space-y-4">
            {defs.objects.map((o) => (
              <ObjectCard
                key={o.object}
                obj={o}
                onAddField={() => setAddFieldFor(o.object)}
                onEditField={(f) => setEditField({ obj: o.object, field: f })}
              />
            ))}
          </div>

          {/* 关系矩阵 */}
          <div className="mb-3 mt-8 flex items-center gap-2 text-sm font-semibold text-gray-700">
            <GitBranch className="h-4 w-4 text-brand-500" /> 关系矩阵 Relations
            <Badge color="brand">{defs.relations.length}</Badge>
          </div>
          <Card className="p-2">
            <DataTable
              columns={["源对象", "关系", "目标对象", "边字段", "操作"]}
              rows={defs.relations.map((r) => ({
                源对象: objLabel(r.src_type),
                关系: r.rel_type,
                目标对象: objLabel(r.dst_type),
                边字段: Object.keys(r.edge_fields ?? {}).join(", ") || "—",
                操作: r.builtin
                  ? <span className="inline-flex items-center gap-1 text-xs text-gray-400"><Lock className="h-3 w-3" /> 内置</span>
                  : <button
                      className="inline-flex items-center gap-1 text-xs font-medium text-red-600 hover:underline"
                      onClick={async () => {
                        if (!confirm(`删除关系 ${r.src_type}-${r.rel_type}->${r.dst_type}？`)) return;
                        setBusy(true);
                        try { await deleteRelation(tenant, r.src_type, r.rel_type, r.dst_type); reload(); }
                        catch (e) { setErr(String(e)); } finally { setBusy(false); }
                      }}
                    ><Trash2 className="h-3 w-3" /> 删除</button>,
              }))}
            />
          </Card>
        </>
      )}

      {/* 新建对象 */}
      <NewObjectModal
        open={newObj}
        onClose={() => setNewObj(false)}
        busy={busy}
        onSubmit={async (body) => {
          setBusy(true);
          try { await createObject({ tenant_id: tenant, ...body }); setNewObj(false); reload(); }
          catch (e) { setErr(String(e)); } finally { setBusy(false); }
        }}
      />

      {/* 新增字段 */}
      <FieldModal
        open={!!addFieldFor}
        title={`为「${objLabel(addFieldFor ?? "")}」新增字段`}
        busy={busy}
        onClose={() => setAddFieldFor(null)}
        onSubmit={async (f) => {
          if (!addFieldFor) return;
          setBusy(true);
          try { await addField(tenant, addFieldFor, f); setAddFieldFor(null); reload(); }
          catch (e) { setErr(String(e)); } finally { setBusy(false); }
        }}
      />

      {/* 编辑字段（label/type） */}
      <FieldModal
        open={!!editField}
        title={`编辑字段 ${editField?.field.code ?? ""}`}
        busy={busy}
        initial={editField?.field}
        lockCode
        onClose={() => setEditField(null)}
        onSubmit={async (f) => {
          if (!editField) return;
          setBusy(true);
          try {
            await patchField(tenant, editField.obj, editField.field.code, { type: f.type, label: f.label });
            setEditField(null); reload();
          } catch (e) { setErr(String(e)); } finally { setBusy(false); }
        }}
      />

      {/* 新建关系 */}
      <NewRelationModal
        open={newRel}
        objectKeys={objectKeys}
        busy={busy}
        onClose={() => setNewRel(false)}
        onSubmit={async (body) => {
          setBusy(true);
          try { await createRelation(tenant, body); setNewRel(false); reload(); }
          catch (e) { setErr(String(e)); } finally { setBusy(false); }
        }}
      />
    </Layout>
  );
}

// ── 子组件 ────────────────────────────────────────────────────────────
function ObjectCard({ obj, onAddField, onEditField }: {
  obj: ObjectDefinition;
  onAddField: () => void;
  onEditField: (f: ObjectFieldDef) => void;
}) {
  return (
    <Card className="p-5">
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-50 text-brand-600">
            <Boxes className="h-5 w-5" />
          </div>
          <div>
            <div className="flex items-center gap-2 font-semibold text-gray-900">
              {objLabel(obj.object)}
              <span className="text-[11px] uppercase tracking-wide text-gray-400">{obj.object}</span>
              {obj.builtin && <Badge>内置</Badge>}
            </div>
            <div className="text-xs text-gray-500">
              主键 {obj.id ?? "—"} · {obj.fields?.length ?? 0} 个字段{obj.table ? ` · 表 ${obj.table}` : ""}
            </div>
          </div>
        </div>
        <Button variant="outline" onClick={onAddField}>
          <Plus className="h-4 w-4" /> 字段
        </Button>
      </div>
      <DataTable
        columns={["字段", "名称", "类型", "属性", "操作"]}
        rows={(obj.fields ?? []).map((f) => ({
          字段: f.code,
          名称: f.label ?? "—",
          类型: TYPE_LABEL[f.type] ?? f.type,
          属性: f.code === obj.id ? <Badge color="brand">主键</Badge> : (f.builtin ? <Badge>内置</Badge> : <Badge color="green">自定义</Badge>),
          操作: (
            <button
              className="inline-flex items-center gap-1 text-xs font-medium text-brand-600 hover:underline"
              onClick={() => onEditField(f)}
            ><Pencil className="h-3 w-3" /> 编辑</button>
          ),
        }))}
      />
    </Card>
  );
}

function FieldModal({ open, title, onClose, onSubmit, busy, initial, lockCode }: {
  open: boolean; title: string; busy?: boolean;
  initial?: ObjectFieldDef; lockCode?: boolean;
  onClose: () => void;
  onSubmit: (f: { code: string; type: string; label?: string }) => void;
}) {
  const [code, setCode] = useState("");
  const [label, setLabel] = useState("");
  const [type, setType] = useState("str");
  useEffect(() => {
    if (open) { setCode(initial?.code ?? ""); setLabel(initial?.label ?? ""); setType(initial?.type ?? "str"); }
  }, [open, initial]);

  return (
    <Modal open={open} title={title} onClose={onClose}>
      <div className="space-y-4">
        {!lockCode && <TextField label="字段编码 (code)" value={code} onChange={setCode} placeholder="如 region" />}
        <TextField label="中文名称" value={label} onChange={setLabel} placeholder="如 区域" />
        <SelectField label="类型" value={type} onChange={setType}
          options={FIELD_TYPES.map((t) => ({ value: t, label: `${TYPE_LABEL[t]} (${t})` }))} />
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={onClose}>取消</Button>
          <Button disabled={busy || (!lockCode && !code.trim())}
            onClick={() => onSubmit({ code: code.trim(), type, label: label.trim() || undefined })}>
            {busy ? "提交中…" : "保存"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function NewObjectModal({ open, onClose, onSubmit, busy }: {
  open: boolean; busy?: boolean; onClose: () => void;
  onSubmit: (b: { object_key: string; label?: string; id_field: string; id_numeric?: boolean }) => void;
}) {
  const [key, setKey] = useState("");
  const [label, setLabel] = useState("");
  const [idField, setIdField] = useState("");
  useEffect(() => { if (open) { setKey(""); setLabel(""); setIdField(""); } }, [open]);

  return (
    <Modal open={open} title="新建对象" onClose={onClose}>
      <div className="space-y-4">
        <TextField label="对象编码 (object_key)" value={key} onChange={setKey} placeholder="如 campaign" />
        <TextField label="中文名称" value={label} onChange={setLabel} placeholder="如 活动" />
        <TextField label="主键字段 (id_field)" value={idField} onChange={setIdField} placeholder="如 campaign_id" />
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={onClose}>取消</Button>
          <Button disabled={busy || !key.trim() || !idField.trim()}
            onClick={() => onSubmit({ object_key: key.trim(), label: label.trim() || undefined, id_field: idField.trim() })}>
            {busy ? "创建中…" : "创建"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function NewRelationModal({ open, objectKeys, onClose, onSubmit, busy }: {
  open: boolean; objectKeys: string[]; busy?: boolean;
  onClose: () => void;
  onSubmit: (b: { src_type: string; rel_type: string; dst_type: string }) => void;
}) {
  const [src, setSrc] = useState("");
  const [rel, setRel] = useState("");
  const [dst, setDst] = useState("");
  useEffect(() => {
    if (open) { setSrc(objectKeys[0] ?? ""); setRel(""); setDst(objectKeys[0] ?? ""); }
  }, [open, objectKeys]);

  const opts = objectKeys.map((k) => ({ value: k, label: `${objLabel(k)} (${k})` }));
  return (
    <Modal open={open} title="新建关系" onClose={onClose}>
      <div className="space-y-4">
        <SelectField label="源对象" value={src} onChange={setSrc} options={opts} />
        <TextField label="关系类型 (rel_type)" value={rel} onChange={setRel} placeholder="如 owns / visited" />
        <SelectField label="目标对象" value={dst} onChange={setDst} options={opts} />
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={onClose}>取消</Button>
          <Button disabled={busy || !src || !rel.trim() || !dst}
            onClick={() => onSubmit({ src_type: src, rel_type: rel.trim(), dst_type: dst })}>
            {busy ? "创建中…" : "创建"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
