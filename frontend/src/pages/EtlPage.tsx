import type { ReactNode } from "react";
import { Database, FileSpreadsheet, Radio, Cloud, ArrowRight, Filter, Wand2 } from "lucide-react";
import Layout from "../components/layout/Layout";
import { Card, Badge } from "../components/ui";
import { OBJECTS } from "../lib/objects";

// 可视化 ETL（多数据源 → 导入多对象 → 筛选）— 当前为前端原型，后端 ETL 引擎待补。
const SOURCES = [
  { icon: Database, name: "MySQL", desc: "业务库 / 离线表" },
  { icon: Radio, name: "Kafka", desc: "实时事件流" },
  { icon: FileSpreadsheet, name: "CSV / Excel", desc: "批量导入" },
  { icon: Cloud, name: "REST API", desc: "三方数据源" },
];
const TRANSFORMS = ["字段映射", "清洗 / 去重", "OneID 关联", "标签计算"];

function Node({ children, color = "white" }: { children: ReactNode; color?: string }) {
  return (
    <div className={`rounded-xl border px-4 py-3 text-sm shadow-sm ${color === "white" ? "border-gray-200 bg-white" : color}`}>
      {children}
    </div>
  );
}

export default function EtlPage() {
  const targets = OBJECTS.filter((o) => o.kind === "object" || o.kind === "mock");
  return (
    <Layout title="可视化 ETL">
      <div className="mb-5 flex items-center gap-2">
        <p className="text-sm text-gray-500">多数据源 → 导入多对象 → 进入统一筛选</p>
        <Badge color="amber">原型 · 后端待补</Badge>
      </div>

      <Card className="overflow-x-auto p-6">
        <div className="flex min-w-[920px] items-stretch gap-6">
          {/* 数据源 */}
          <div className="flex-1">
            <div className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-400">数据源（多源）</div>
            <div className="space-y-3">
              {SOURCES.map((s) => (
                <Node key={s.name}>
                  <div className="flex items-center gap-2.5">
                    <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gray-100 text-gray-600">
                      <s.icon className="h-4 w-4" />
                    </div>
                    <div>
                      <div className="font-medium text-gray-800">{s.name}</div>
                      <div className="text-xs text-gray-400">{s.desc}</div>
                    </div>
                  </div>
                </Node>
              ))}
            </div>
          </div>

          <Arrow />

          {/* 转换 */}
          <div className="flex-1">
            <div className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-400">转换 / 清洗</div>
            <Node color="border-brand-200 bg-brand-50">
              <div className="mb-2 flex items-center gap-2 font-medium text-brand-700">
                <Wand2 className="h-4 w-4" /> Transform Pipeline
              </div>
              <div className="space-y-2">
                {TRANSFORMS.map((t, i) => (
                  <div key={t} className="flex items-center gap-2 rounded-lg bg-white px-3 py-2 text-xs text-gray-600">
                    <span className="flex h-5 w-5 items-center justify-center rounded-full bg-brand-100 text-[10px] font-semibold text-brand-600">{i + 1}</span>
                    {t}
                  </div>
                ))}
              </div>
            </Node>
          </div>

          <Arrow />

          {/* 目标对象 */}
          <div className="flex-1">
            <div className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-400">导入目标（多对象）</div>
            <div className="grid grid-cols-2 gap-2">
              {targets.map((o) => (
                <Node key={o.key}>
                  <div className="flex items-center gap-2">
                    <o.icon className="h-4 w-4 text-gray-500" />
                    <span className="font-medium text-gray-700">{o.label}</span>
                  </div>
                </Node>
              ))}
            </div>
            <div className="mt-3 flex items-center justify-center gap-2 rounded-xl border border-dashed border-green-300 bg-green-50 px-4 py-3 text-sm font-medium text-green-700">
              <Filter className="h-4 w-4" /> 进入统一筛选器
            </div>
          </div>
        </div>
      </Card>

      <Card className="mt-4 p-4 text-sm text-gray-500">
        说明：拖拽编排、字段映射、调度运行等需后端 ETL 引擎支撑（可对接 DolphinScheduler / Flink）。本页为交互原型，先确定信息架构与流程。
      </Card>
    </Layout>
  );
}

function Arrow() {
  return (
    <div className="flex items-center">
      <ArrowRight className="h-6 w-6 text-gray-300" />
    </div>
  );
}
