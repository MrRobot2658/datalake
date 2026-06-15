# 模块 12 · 分析 Analyst

## 概述

可视化指标看板 + **自然语言（NL）一句话生成图表/看板** + **图表下钻**。一级菜单，**真实数据**（聚合自演示业务数据）。安全模型同 DSL：**LLM 不写 SQL**，只从后端**白名单数据源目录**里受限选择数据源与图表类型。

## 详细设计（产品）

- **看板列表**（`/analyst`）：
  - 3 个**内置画像看板**：用户画像 / 客户画像 / 转化率ROI（KPI 卡 + 多图）。
  - **自定义看板**：NL 一句话「生成并创建」（描述 → DeepSeek 选 3-6 个数据源 → 直接落库）→ 进详情可**二次编辑**（改标题 / 加减图表）。
- **图表**：recharts 渲染 bar / line / area / pie；**点击数据点下钻** → 弹出该点背后的明细记录表。
- **NL 生成单图**：描述 → 选 source + 图表类型 → 预览/保存（`analyst_charts`）。

### 数据源目录（白名单聚合）

`objects_count`（各对象量）· `account_industry/scale` · `order_status/channel` · `lead_stage/city/source` · `product_category` · `store_region`。均为 `COUNT` / 白名单字段 `GROUP BY`，杜绝注入。

### KPI

用户/客户/线索/订单数、合格线索、GMV、客单价、线索转化率、订单支付率。

### 数据模型

- `analyst_charts`：`id / tenant_id / title / type / source / sort_order / created_at`
- `analyst_dashboards`：`id / tenant_id / title / sources(JSON) / created_at`

## 技术设计

- **前端**：`pages/AnalystPage.tsx`（看板列表 + NL 新建）、`pages/analyst/{User,Account,Roi,Custom}DashboardPage.tsx`、`components/analyst/AnalystChart.tsx`（可下钻图卡）、`api/analyst.ts`、依赖 `recharts`。一级菜单「分析」（含 4 个子项）。
- **后端**：`services/sql-engine/analyst_api.py`（`AnalystService`，前缀 `/analyst`）。
  - 数据：`GET /analyst/sources`、`GET /analyst/data`、`GET /analyst/drilldown`、`GET /analyst/kpis`。
  - 图表：`GET·POST·DELETE /analyst/charts` + `POST /analyst/charts/nl`。
  - 看板：`GET·POST·PUT·DELETE /analyst/dashboards` + `POST /analyst/dashboards/nl`。
  - NL：DeepSeek（`response_format=json_object`）受限选 source/类型；无 key/失败降级关键词。
- **基础设施**：`sql/migrate_analyst.sql`（含默认图表）、`sql/migrate_dashboards.sql`。
- 真实 vs Mock：**全真实**（数据为实时聚合，下钻为真实记录）。

## TODOs

- `[后端]` `[数据]` P1 时间序列/趋势源（按 `create_time` 分桶）→ line/area 真实趋势。
- `[后端]` P1 更多维度与跨对象指标（漏斗：线索→订单→支付为真实 funnel）。
- `[前端]` P2 看板布局可拖拽、定时刷新、分享/导出（PNG/PDF）。
- `[后端]` P2 NL 生成支持过滤条件（不止选维度，带 where）；图表缓存。
