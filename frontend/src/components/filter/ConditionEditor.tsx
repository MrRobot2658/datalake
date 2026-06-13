import { Plus, X } from "lucide-react";
import type { Leaf, Op } from "../../api/types";
import { OP_LABELS, opsForType } from "../../lib/objects";

export interface FieldOption {
  code: string;
  type: string;
  label?: string;
}

const sel =
  "rounded-lg border border-gray-300 bg-white px-2.5 py-1.5 text-sm text-gray-700 focus:border-brand-400 focus:outline-none";

export default function ConditionEditor({
  fieldOptions,
  value,
  onChange,
  logic,
  onLogicChange,
  addLabel = "添加条件",
  emptyHint,
}: {
  fieldOptions: FieldOption[];
  value: Leaf[];
  onChange: (v: Leaf[]) => void;
  logic?: "AND" | "OR";
  onLogicChange?: (l: "AND" | "OR") => void;
  addLabel?: string;
  emptyHint?: string;
}) {
  const update = (i: number, patch: Partial<Leaf>) =>
    onChange(value.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  const remove = (i: number) => onChange(value.filter((_, j) => j !== i));
  const add = () => {
    const f = fieldOptions[0];
    if (!f) return;
    onChange([...value, { field: f.code, op: opsForType(f.type)[0] as Op, value: "" }]);
  };

  const typeOf = (code: string) => fieldOptions.find((f) => f.code === code)?.type || "str";

  return (
    <div className="space-y-2">
      {logic && onLogicChange && value.length > 1 && (
        <div className="flex items-center gap-2 text-xs text-gray-500">
          <span>条件组合</span>
          <div className="inline-flex overflow-hidden rounded-md border border-gray-300">
            {(["AND", "OR"] as const).map((l) => (
              <button
                key={l}
                onClick={() => onLogicChange(l)}
                className={`px-2.5 py-1 text-xs font-medium ${
                  logic === l ? "bg-brand-500 text-white" : "bg-white text-gray-600"
                }`}
              >
                {l === "AND" ? "且 AND" : "或 OR"}
              </button>
            ))}
          </div>
        </div>
      )}

      {value.length === 0 && emptyHint && (
        <p className="text-xs text-gray-400">{emptyHint}</p>
      )}

      {value.map((c, i) => {
        const t = typeOf(c.field);
        const ops = opsForType(t);
        return (
          <div key={i} className="flex flex-wrap items-center gap-2">
            <select
              className={sel}
              value={c.field}
              onChange={(e) => {
                const nt = typeOf(e.target.value);
                update(i, { field: e.target.value, op: opsForType(nt)[0] as Op });
              }}
            >
              {fieldOptions.map((f) => (
                <option key={f.code} value={f.code}>
                  {f.label ? `${f.label} (${f.code})` : f.code}
                </option>
              ))}
            </select>
            <select className={sel} value={c.op} onChange={(e) => update(i, { op: e.target.value as Op })}>
              {ops.map((o) => (
                <option key={o} value={o}>{OP_LABELS[o] || o}</option>
              ))}
            </select>
            <ValueInput op={c.op} value={c.value} onChange={(v) => update(i, { value: v })} />
            <button onClick={() => remove(i)} className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-red-500">
              <X className="h-4 w-4" />
            </button>
          </div>
        );
      })}

      <button
        onClick={add}
        disabled={fieldOptions.length === 0}
        className="inline-flex items-center gap-1 text-sm font-medium text-brand-600 hover:text-brand-700 disabled:text-gray-300"
      >
        <Plus className="h-4 w-4" /> {addLabel}
      </button>
    </div>
  );
}

const inp =
  "rounded-lg border border-gray-300 bg-white px-2.5 py-1.5 text-sm text-gray-700 focus:border-brand-400 focus:outline-none";

function ValueInput({ op, value, onChange }: { op: string; value: any; onChange: (v: any) => void }) {
  if (op === "between") {
    const arr = Array.isArray(value) ? value : ["", ""];
    return (
      <div className="flex items-center gap-1">
        <input className={`${inp} w-32`} placeholder="起" value={arr[0] ?? ""} onChange={(e) => onChange([e.target.value, arr[1] ?? ""])} />
        <span className="text-gray-400">~</span>
        <input className={`${inp} w-32`} placeholder="止" value={arr[1] ?? ""} onChange={(e) => onChange([arr[0] ?? "", e.target.value])} />
      </div>
    );
  }
  if (op === "in" || op === "not_in") {
    const str = Array.isArray(value) ? value.join(",") : value ?? "";
    return (
      <input
        className={`${inp} w-48`}
        placeholder="逗号分隔，如 a,b,c"
        value={str}
        onChange={(e) => onChange(e.target.value.split(",").map((s) => s.trim()).filter(Boolean))}
      />
    );
  }
  return (
    <input className={`${inp} w-48`} placeholder="取值" value={value ?? ""} onChange={(e) => onChange(e.target.value)} />
  );
}
