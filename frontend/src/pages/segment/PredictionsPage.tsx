import { useEffect, useState, useCallback } from "react";
import { Sparkles, Plus } from "lucide-react";
import Layout from "../../components/layout/Layout";
import { Card, Button, Modal, TextField, Spinner } from "../../components/ui";
import { StatusPill, EmptyState } from "../../components/segment/kit";
import { useTenant } from "../../context/TenantContext";
import {
  listPredictions, createPrediction, inferPrediction,
  type PredictionModel, type PredictionModelInput,
} from "../../api/unify";

const EMPTY: PredictionModelInput = {
  model_name: "", model_type: "purchase", target_event: "",
  features: [], inference_horizon: "14d", enabled: true,
};

export default function PredictionsPage() {
  const { tenant } = useTenant();
  const [models, setModels] = useState<PredictionModel[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<PredictionModelInput>(EMPTY);
  const [featuresText, setFeaturesText] = useState("");
  const [saving, setSaving] = useState(false);
  const [inferring, setInferring] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      setModels(await listPredictions(tenant));
    } catch (e: any) {
      setError(e?.response?.data?.detail || e.message || "加载失败");
    } finally {
      setLoading(false);
    }
  }, [tenant]);

  useEffect(() => { load(); }, [load]);

  async function save() {
    if (!form.model_name.trim()) { setError("请填写模型名"); return; }
    setSaving(true); setError(null);
    try {
      await createPrediction(tenant, {
        ...form,
        features: featuresText.split(",").map((s) => s.trim()).filter(Boolean),
      });
      setOpen(false); setForm(EMPTY); setFeaturesText("");
      await load();
    } catch (e: any) {
      setError(e?.response?.data?.detail || e.message || "保存失败");
    } finally {
      setSaving(false);
    }
  }

  async function infer(modelId: string) {
    setInferring(modelId); setError(null); setMsg(null);
    try {
      const r = await inferPrediction(tenant, modelId);
      setMsg(`推理完成：写入 ${r.row_count} 个档案 ${r.property_key}，质量评分 ${r.quality_score}`);
      await load();
    } catch (e: any) {
      setError(e?.response?.data?.detail || e.message || "推理失败");
    } finally {
      setInferring(null);
    }
  }

  return (
    <Layout
      title="预测 Predictions"
      subtitle="基于用户行为训练的倾向性预测模型（评分写入用户宽表 properties）"
      actions={<Button onClick={() => { setForm(EMPTY); setFeaturesText(""); setError(null); setOpen(true); }}>
        <Plus className="h-4 w-4" /> 新建模型
      </Button>}
    >
      {error && <div className="mb-4 rounded-lg bg-red-50 px-4 py-2 text-sm text-red-600">{error}</div>}
      {msg && <div className="mb-4 rounded-lg bg-brand-50 px-4 py-2 text-sm text-brand-700">{msg}</div>}

      {loading ? (
        <div className="flex justify-center py-12"><Spinner /></div>
      ) : models.length === 0 ? (
        <EmptyState icon={Sparkles} title="暂无预测模型"
          desc="创建一个倾向性预测模型（购买 / 流失 / LTV），推理后评分回填到用户档案。"
          action={<Button onClick={() => setOpen(true)}><Plus className="h-4 w-4" /> 新建模型</Button>} />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {models.map((m) => (
            <Card key={m.model_id} className="flex h-full flex-col p-5">
              <div className="mb-3 flex items-center justify-between">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-50 text-brand-600">
                  <Sparkles className="h-5 w-5" />
                </div>
                <StatusPill tone={m.last_inference_at ? "green" : "gray"}>
                  {m.last_inference_at ? "已推理" : "未推理"}
                </StatusPill>
              </div>
              <div className="font-semibold text-gray-900">{m.model_name}</div>
              <div className="text-[11px] uppercase tracking-wide text-gray-400">{m.model_type}</div>
              <div className="mt-1 text-sm text-gray-500">
                目标 {m.target_event || "—"} · 窗口 {m.inference_horizon || "—"}
              </div>
              <div className="mt-1 text-sm text-gray-500">
                质量评分 {m.quality_score ?? "—"} · 特征 {m.features?.length || 0} 个
              </div>
              <div className="mt-4">
                <Button variant="outline" onClick={() => infer(m.model_id)} disabled={inferring === m.model_id}>
                  <Sparkles className="h-4 w-4" /> {inferring === m.model_id ? "推理中…" : "运行推理"}
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}

      <Modal open={open} title="新建预测模型" onClose={() => setOpen(false)}>
        <div className="space-y-3">
          <TextField label="模型名" value={form.model_name}
            placeholder="购买倾向" onChange={(v) => setForm({ ...form, model_name: v })} />
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-gray-700">模型类型</span>
            <select className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              value={form.model_type}
              onChange={(e) => setForm({ ...form, model_type: e.target.value })}>
              <option value="purchase">purchase（购买倾向）</option>
              <option value="churn">churn（流失倾向）</option>
              <option value="ltv">ltv（生命周期价值）</option>
            </select>
          </label>
          <TextField label="目标事件" value={form.target_event ?? ""}
            placeholder="order_paid" onChange={(v) => setForm({ ...form, target_event: v })} />
          <TextField label="推理窗口" value={form.inference_horizon ?? ""}
            placeholder="14d" onChange={(v) => setForm({ ...form, inference_horizon: v })} />
          <TextField label="特征（逗号分隔）" value={featuresText}
            placeholder="total_orders, channel_count" onChange={setFeaturesText} />
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setOpen(false)}>取消</Button>
            <Button onClick={save} disabled={saving}>{saving ? "保存中…" : "保存"}</Button>
          </div>
        </div>
      </Modal>
    </Layout>
  );
}
