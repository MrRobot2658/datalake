import { Link2, Plus, Trash2 } from "lucide-react";
import type { Metadata, Relation } from "../../api/types";
import { byKey } from "../../lib/objects";
import ConditionEditor, { type FieldOption } from "./ConditionEditor";

const MAX_DEPTH = 3;
const sel =
  "rounded-lg border border-gray-300 bg-white px-2.5 py-1.5 text-sm text-gray-700 focus:border-brand-400 focus:outline-none";

interface RelOption {
  rel_type: string;
  object: string;
  direction: "forward" | "reverse";
  label: string;
}

function relOptions(meta: Metadata, source: string): RelOption[] {
  const out: RelOption[] = [];
  for (const r of meta.relations) {
    if (r.src_type === source)
      out.push({ rel_type: r.rel_type, object: r.dst_type, direction: "forward",
        label: `${r.rel_type} → ${byKey(r.dst_type)?.label || r.dst_type}` });
    if (r.dst_type === source)
      out.push({ rel_type: r.rel_type, object: r.src_type, direction: "reverse",
        label: `${r.rel_type} ← ${byKey(r.src_type)?.label || r.src_type}（反向）` });
  }
  return out;
}

function fieldsOf(meta: Metadata, obj: string): FieldOption[] {
  return (meta.objects.find((o) => o.object === obj)?.fields || []).map((f) => ({ code: f.code, type: f.type }));
}

function edgeFieldsOf(meta: Metadata, rel: Relation): FieldOption[] {
  const m = meta.relations.find(
    (r) =>
      r.rel_type === rel.rel_type &&
      ((rel.direction !== "reverse" && r.dst_type === rel.object) ||
        (rel.direction === "reverse" && r.src_type === rel.object)),
  );
  return Object.entries(m?.edge_fields || {}).map(([code, spec]) => ({ code, type: spec.type, label: spec.label }));
}

export default function RelationEditor({
  meta, source, value, onChange, onRemove, depth = 1,
}: {
  meta: Metadata;
  source: string;
  value: Relation;
  onChange: (r: Relation) => void;
  onRemove: () => void;
  depth?: number;
}) {
  const opts = relOptions(meta, source);
  const curKey = `${value.rel_type}|${value.object}|${value.direction || "forward"}`;

  const pick = (key: string) => {
    const o = opts.find((x) => `${x.rel_type}|${x.object}|${x.direction}` === key);
    if (o) onChange({ rel_type: o.rel_type, object: o.object, direction: o.direction, conditions: [], edge_conditions: [], relations: [] });
  };

  return (
    <div className="rounded-xl border border-brand-100 bg-brand-50/40 p-4">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-medium text-brand-700">
          <Link2 className="h-4 w-4" /> 关联（{byKey(source)?.label || source} 的）
        </div>
        <button onClick={onRemove} className="rounded p-1 text-gray-400 hover:bg-white hover:text-red-500">
          <Trash2 className="h-4 w-4" />
        </button>
      </div>

      <select className={`${sel} mb-3`} value={curKey} onChange={(e) => pick(e.target.value)}>
        {opts.map((o) => (
          <option key={`${o.rel_type}|${o.object}|${o.direction}`} value={`${o.rel_type}|${o.object}|${o.direction}`}>
            {o.label}
          </option>
        ))}
      </select>

      <div className="space-y-4 pl-1">
        <div>
          <div className="mb-1 text-xs font-semibold text-gray-500">目标对象条件（{byKey(value.object)?.label || value.object}）</div>
          <ConditionEditor
            fieldOptions={fieldsOf(meta, value.object)}
            value={value.conditions || []}
            onChange={(c) => onChange({ ...value, conditions: c })}
            logic={value.logic || "AND"}
            onLogicChange={(l) => onChange({ ...value, logic: l })}
            emptyHint="不加条件 = 只要存在该关联即命中"
          />
        </div>

        {edgeFieldsOf(meta, value).length > 0 && (
          <div>
            <div className="mb-1 text-xs font-semibold text-gray-500">边条件（关系行：发生时间 / 属性）</div>
            <ConditionEditor
              fieldOptions={edgeFieldsOf(meta, value)}
              value={value.edge_conditions || []}
              onChange={(c) => onChange({ ...value, edge_conditions: c })}
              addLabel="添加边条件"
              emptyHint="如「create_time 不小于 …」过滤最近 N 天"
            />
          </div>
        )}

        {depth < MAX_DEPTH && (
          <div className="space-y-3">
            {(value.relations || []).map((nr, i) => (
              <RelationEditor
                key={i}
                meta={meta}
                source={value.object}
                value={nr}
                depth={depth + 1}
                onChange={(r) => onChange({ ...value, relations: (value.relations || []).map((x, j) => (j === i ? r : x)) })}
                onRemove={() => onChange({ ...value, relations: (value.relations || []).filter((_, j) => j !== i) })}
              />
            ))}
            {relOptions(meta, value.object).length > 0 && (
              <button
                onClick={() => {
                  const o = relOptions(meta, value.object)[0];
                  onChange({ ...value, relations: [...(value.relations || []), { rel_type: o.rel_type, object: o.object, direction: o.direction, conditions: [], edge_conditions: [], relations: [] }] });
                }}
                className="inline-flex items-center gap-1 text-xs font-medium text-brand-600 hover:text-brand-700"
              >
                <Plus className="h-3.5 w-3.5" /> 链式下一跳（≤{MAX_DEPTH} 跳）
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
