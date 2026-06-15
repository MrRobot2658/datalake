import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Filter, Workflow, ArrowRight } from "lucide-react";
import Layout from "../components/layout/Layout";
import { Card, Spinner } from "../components/ui";
import { StatCards } from "../components/segment/kit";
import AnalystChart from "../components/analyst/AnalystChart";
import { getKpis, type Kpis } from "../api/analyst";
import { useTenant } from "../context/TenantContext";
import { useLang } from "../context/LangContext";

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const money = (x: number) => `¥${x.toLocaleString()}`;

// 总览看板：核心 KPI + 关键图表（可下钻）+ 快捷入口。
export default function Dashboard() {
  const { tenant } = useTenant();
  const { tr } = useLang();
  const [kpi, setKpi] = useState<Kpis | null>(null);

  useEffect(() => {
    setKpi(null);
    getKpis(tenant).then(setKpi).catch(() => setKpi(null));
  }, [tenant]);

  const charts: { title: string; type: "bar" | "pie"; source: string }[] = [
    { title: tr("各对象数据量", "Records per Object"), type: "bar", source: "objects_count" },
    { title: tr("订单状态分布", "Orders by Status"), type: "pie", source: "order_status" },
    { title: tr("线索阶段分布", "Leads by Stage"), type: "bar", source: "lead_stage" },
    { title: tr("客户行业分布", "Accounts by Industry"), type: "pie", source: "account_industry" },
  ];

  return (
    <Layout
      title={tr("总览看板 Overview", "Overview Dashboard")}
      subtitle={tr("数据底座核心指标与关键分布 · 点击图表可下钻明细", "Core metrics and key distributions of the data foundation · click a chart to drill down")}
    >
      {kpi ? (
        <StatCards items={[
          { label: tr("用户数", "Users"), value: kpi.users },
          { label: tr("客户数", "Accounts"), value: kpi.accounts },
          { label: tr("线索数", "Leads"), value: kpi.leads },
          { label: tr("订单数", "Orders"), value: kpi.orders },
          { label: tr("GMV", "GMV"), value: money(kpi.gmv) },
          { label: tr("线索转化率", "Lead Conv."), value: pct(kpi.lead_qualified_rate) },
        ]} />
      ) : (
        <div className="mb-4 flex items-center gap-2 text-sm text-gray-400"><Spinner /> {tr("指标加载中…", "Loading metrics…")}</div>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        {charts.map((c) => (
          <AnalystChart key={c.source} tenant={tenant} title={c.title} type={c.type} source={c.source} />
        ))}
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <Link to="/engage/audiences/new">
          <Card className="flex items-center justify-between p-6 transition-shadow hover:shadow-md">
            <div className="flex items-center gap-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-brand-500 text-white">
                <Filter className="h-6 w-6" />
              </div>
              <div>
                <div className="font-semibold text-gray-900">{tr("创建受众 · Engage", "Create Audience · Engage")}</div>
                <div className="text-sm text-gray-500">{tr("多条件 / 跨对象 / 自然语言圈人", "Multi-condition / cross-object / natural-language audiences")}</div>
              </div>
            </div>
            <ArrowRight className="h-5 w-5 text-gray-300" />
          </Card>
        </Link>
        <Link to="/connections/catalog">
          <Card className="flex items-center justify-between p-6 transition-shadow hover:shadow-md">
            <div className="flex items-center gap-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-brand-400 text-white">
                <Workflow className="h-6 w-6" />
              </div>
              <div>
                <div className="font-semibold text-gray-900">{tr("接入数据源 · Connections", "Connect Sources · Connections")}</div>
                <div className="text-sm text-gray-500">{tr("44 个连接器 → 导入多对象", "44 connectors → import into multiple objects")}</div>
              </div>
            </div>
            <ArrowRight className="h-5 w-5 text-gray-300" />
          </Card>
        </Link>
      </div>
    </Layout>
  );
}
