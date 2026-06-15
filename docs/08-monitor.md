# 模块 08 · 监控 Monitor

> 状态：后端已落地（4 张表 + 19 个端点，pytest 全局 411P/0F/2S 通过） · 前端仍 Mock 待接 · 对标 Segment Monitor

## 1. 概述

监控 Monitor 是 CDP 的「可观测性中枢」，对标 Twilio Segment 的 **Monitor**（Delivery Overview / Sources Debugger / Alerts / Event Logs）。它回答三个问题：**数据进来了吗？（吞吐）**、**进得健康吗？（成功率/时延/数据源健康）**、**出问题谁知道？（告警 + 逐事件投递日志）**。

当前实现为 **100% 前端 Mock**：三个页面用 `mock/data.ts` 的静态数据 + `components/segment/kit.tsx` 的 `Sparkline`/`StatCards` 渲染，右上角统一带「Mock 数据」角标。但底层链路里**已经存在两类真实信号**，可作为「接真」的起点：

- **id-mapping 合并日志** `GET /merge-log/{tenant}`：真实的 OneID 合并事件流，天然是一条「事件日志 / 吞吐」雏形。
- **入库路径** `POST /events/process`、`POST /etl/import`：所有事件/批量数据的真实入口，是埋「吞吐 / 成功率 / 时延」采集点的最佳位置。

本模块的目标是把 Mock 的指标卡与表格逐步替换为「采集中间件 → 聚合存储 → 查询端点 → 告警引擎」的真实链路。

## 2. 详细设计（产品）

### 2.1 子功能清单

| 功能 | 英文 | 状态 | 说明 |
|------|------|------|------|
| 投递概览 | Delivery Overview | Mock | 近24h事件量、成功率、失败数、P95 时延、事件量趋势图 |
| 数据源健康 | Sources Health | Mock | 各数据源近24h事件、错误率、健康状态 |
| 告警规则 | Alerts | Mock | 阈值规则列表（成功率/事件量/违规），通知渠道与触发状态 |
| 新建告警 | Create Alert | Mock | 按钮存在，无表单/无后端 |
| 事件投递日志 | Event Logs | Mock | 逐事件追踪：数据源 → 目的地，状态 + HTTP code |
| 指标采集 | Metrics Collection | 待建 | 入库路径打点（吞吐/成功率/时延） |
| 告警引擎 | Alert Engine | 待建 | 规则评估 + 通知下发（邮件/飞书） |

### 2.2 信息架构与页面

| 路由 | 页面文件 | 说明 | 状态 |
|------|----------|------|------|
| `/monitor` | `frontend/src/pages/segment/DeliveryPage.tsx` | 投递概览：吞吐/成功率/P95/趋势 + 数据源健康表 | Mock |
| `/monitor/alerts` | `frontend/src/pages/segment/AlertsPage.tsx` | 告警规则列表 + 统计卡 + 新建按钮 | Mock |
| `/monitor/logs` | `frontend/src/pages/segment/EventLogsPage.tsx` | 事件投递日志表（数据源→目的地） | Mock |

路由注册见 `frontend/src/App.tsx`，导航见 `frontend/src/lib/nav.ts`。

### 2.3 关键用户流程

> 运维/数据工程师排障主线：**看投递概览 → 下钻数据源健康 → 配告警 → 查事件投递日志**

1. **看投递概览**：进入 `/monitor`，先看四张指标卡（近24h事件 / 成功率 / 失败 / P95 时延）与事件量趋势 Sparkline，建立整体健康直觉。
2. **下钻数据源健康**：发现成功率掉了，往下看「数据源健康」表，定位是哪个 `source` 错误率飙升、状态异常。
3. **配告警**：为避免下次靠人盯，去 `/monitor/alerts` 新建规则（如「成功率 < 95% 持续 5min」），绑定通知渠道（邮件/飞书）与范围（某数据源/全局）。
4. **查事件投递日志**：告警触发后回到 `/monitor/logs`，按数据源/目的地/状态/HTTP code 逐条排查失败事件，定位具体目的地（Destination）投递失败原因。

### 2.4 数据模型

> 本模块 4 张表均**已建**（`sql/migrate_modules.sql`，`CREATE TABLE IF NOT EXISTS` + `utf8mb4_unicode_ci`，经 `scripts/apply_migrations.sh` 应用）。全表含 `tenant_id`，所有查询按租户隔离。下列 DDL 要点取自迁移文件真实定义。

#### `monitor_metrics` —— 监控指标聚合（已建）

分钟/小时桶聚合表，替代真时序库的轻量方案。写入用 `ON DUPLICATE KEY UPDATE` 按主键累加计数、分位取最新值。

| 列 | 类型 | 说明 |
|----|------|------|
| `tenant_id` | BIGINT NOT NULL | 租户（联合主键） |
| `bucket_ts` | DATETIME NOT NULL | 分钟/小时桶时间戳（联合主键） |
| `source` | VARCHAR(128) NOT NULL DEFAULT '' | 数据源名称（联合主键） |
| `events_total` | INT DEFAULT 0 | 桶内事件总数 |
| `success_count` / `failed_count` | INT DEFAULT 0 | 成功 / 失败计数 |
| `latency_ms_p50` / `latency_ms_p95` / `latency_ms_p99` | INT | 时延分位 |
| `created_at` / `updated_at` | DATETIME | 创建 / 更新（ON UPDATE CURRENT_TIMESTAMP） |

- 主键：`(tenant_id, bucket_ts, source)`
- 索引：`idx_tenant_time(tenant_id, bucket_ts)`、`idx_tenant_source(tenant_id, source, bucket_ts)`

#### `monitor_alert_rule` —— 告警规则（已建）

| 列 | 类型 | 说明 |
|----|------|------|
| `id` | BIGINT AUTO_INCREMENT PK | 主键 |
| `tenant_id` | BIGINT NOT NULL | 租户 |
| `name` | VARCHAR(256) NOT NULL | 规则名称 |
| `metric` | VARCHAR(64) NOT NULL | success_rate/event_count/error_rate/latency_p95 |
| `operator` | VARCHAR(32) NOT NULL | lt/gt/eq/gte/lte |
| `threshold` | DECIMAL(10,2) NOT NULL | 阈值 |
| `window_minutes` | INT DEFAULT 5 | 评估窗口（分钟） |
| `scope` / `scope_value` | VARCHAR(64) / VARCHAR(256) | all_sources/specific_source/specific_destination 及其取值 |
| `channel` | VARCHAR(128) NOT NULL | email/feishu/webhook |
| `channel_config` | JSON | 渠道配置 |
| `severity` | VARCHAR(32) DEFAULT 'medium' | high/medium/low |
| `enabled` | TINYINT DEFAULT 1 | 是否启用 |
| `created_at` / `updated_at` | DATETIME | 时间戳 |

- 索引：`idx_tenant(tenant_id)`、`idx_tenant_enabled(tenant_id, enabled)`

#### `monitor_alert_event` —— 告警触发记录（已建）

| 列 | 类型 | 说明 |
|----|------|------|
| `id` | BIGINT AUTO_INCREMENT PK | 主键 |
| `tenant_id` | BIGINT NOT NULL | 租户 |
| `rule_id` | BIGINT NOT NULL | 关联 `monitor_alert_rule.id` |
| `fired_at` | DATETIME NOT NULL | 触发时刻 |
| `metric_value` | DECIMAL(10,2) | 触发时指标值 |
| `status` | VARCHAR(32) DEFAULT 'triggered' | triggered/acknowledged/resolved |
| `acknowledged_at` / `acknowledged_by` | DATETIME / VARCHAR(128) | 确认时刻 / 确认人 |
| `resolved_at` | DATETIME | 解决时刻 |
| `detail` | JSON | 触发明细（含 overview 快照） |
| `created_at` | DATETIME | 创建时间 |

- 索引：`idx_rule_fired(rule_id, fired_at)`、`idx_tenant_fired(tenant_id, fired_at)`
- 外键：`fk_alert_rule (rule_id) REFERENCES monitor_alert_rule(id) ON DELETE CASCADE`（删规则级联清触发记录）

#### `event_delivery_log` —— 逐事件投递日志（已建）

| 列 | 类型 | 说明 |
|----|------|------|
| `id` | BIGINT AUTO_INCREMENT PK | 主键 |
| `tenant_id` | BIGINT NOT NULL | 租户 |
| `ts` | DATETIME NOT NULL | 事件处理时刻 |
| `source` | VARCHAR(128) NOT NULL | 数据源名称 |
| `event_name` | VARCHAR(256) | 事件类型名 |
| `destination` | VARCHAR(256) | 目的地名称 |
| `status` | VARCHAR(32) DEFAULT 'success' | success/failed/retry/skipped |
| `http_code` | INT | 投递返回码 |
| `latency_ms` | INT | 投递耗时 |
| `error_message` | VARCHAR(512) | 失败原因 |
| `event_id` | VARCHAR(256) | 原始事件 ID |
| `detail` | JSON | 明细 |
| `created_at` | DATETIME | 创建时间 |

- 索引：`idx_tenant_ts(tenant_id, ts)`、`idx_source_dest(tenant_id, source, destination, ts)`、`idx_status(tenant_id, status, ts)`

**Mock 字段对照（`frontend/src/mock/data.ts`）**：`deliveryMetrics`(events24h/successRate/failed24h/p95LatencyMs/series[]) ↔ `GET /monitor/overview` + `GET /monitor/metrics`；`sourcesHealth`(source/events24h/errorRate/status) ↔ `GET /monitor/sources`；`alerts`(name/channel/scope/status/severity/last) ↔ `GET /monitor/alert-rules` + `/alert-events`；`eventLogs`(time/source/event/dest/status/code) ↔ `GET /monitor/delivery-logs` —— 前端接真时按此映射逐字段替换。

## 2.5 逻辑设计（本轮落地）

后端落在 `services/sql-engine/monitor_api.py`：自包含一个 `MonitorService`（直连 MySQL，复用 `executor.MysqlOlapExecutor().config`）+ `APIRouter(prefix="/monitor")`，由 `main.py` 以 `include_router` 挂载。**只做加法**：不改 `main.py` 既有内联端点、不动 `schemas.py`/既有 service。所有 SQL 参数化、按 `tenant_id` 隔离；monitor 为可观测指标、不涉及圈人，故不走 `objects.build_sql`/`dsl` 路径（无安全圈人语义）。

### 2.5.1 端点列表

`tenant_id` 均为必填 query 参数；网关 `/api/*` 经 nginx 剥前缀转 sql-engine。

| 方法 | 路径 | 请求（body / 关键 query） | 响应 |
|------|------|---------------------------|------|
| GET | `/monitor/overview` | `source?`, `window_minutes=60` | KPI：events_total/success_count/failed_count/success_rate/error_rate/avg_latency_p50/p95/p99/bucket_count |
| GET | `/monitor/metrics` | `source?`, `start?`, `end?`, `limit=500` | 指标桶时间序列（按 `bucket_ts` 升序，供折线图） |
| POST | `/monitor/metrics` | `MetricUpsert`(bucket_ts, source, events_total, success_count, failed_count, latency_p50/p95/p99) | upsert 后的桶行（累加） |
| GET | `/monitor/sources` | — | 各 source 汇总：events_total/success_count/failed_count/last_bucket_ts/success_rate |
| GET | `/monitor/delivery-logs` | `source?/destination?/status?/event_name?/start?/end?`, `limit=100` | 逐事件投递日志（按 `ts` 降序） |
| POST | `/monitor/delivery-logs` | `DeliveryLogCreate`(source 必填, event_name/destination/status/http_code/latency_ms/error_message/event_id/detail) | 写入的日志行 |
| GET | `/monitor/delivery-stats` | `group_by=status`, `window_minutes=60` | 按 status/source/destination/event_name 分组的 cnt/success/failed/avg_latency |
| GET | `/monitor/alert-rules` | `enabled?` | 规则列表（id 降序） |
| POST | `/monitor/alert-rules` | `AlertRuleCreate` | 新建规则 |
| GET | `/monitor/alert-rules/{rule_id}` | — | 单条规则（404 不存在） |
| PUT | `/monitor/alert-rules/{rule_id}` | `AlertRuleUpdate`（部分字段） | 更新后规则（404 不存在） |
| DELETE | `/monitor/alert-rules/{rule_id}` | — | `{deleted:true,id}`（级联删触发记录） |
| POST | `/monitor/alert-rules/{rule_id}/evaluate` | `fire=true` | 评估结果：metric_value/breached/fired_event |
| GET | `/monitor/alert-events` | `rule_id?/status?`, `limit=100` | 触发记录（JOIN 规则名/metric/severity，fired_at 降序） |
| POST | `/monitor/alert-events` | `AlertEventCreate`(rule_id, fired_at?, metric_value?, detail?) | 新建触发记录（规则不存在 404） |
| GET | `/monitor/alert-events/{event_id}` | — | 单条触发记录（404） |
| POST | `/monitor/alert-events/{event_id}/acknowledge` | `AlertAck`(acknowledged_by?) | 置 acknowledged（仅对 triggered 生效） |
| POST | `/monitor/alert-events/{event_id}/resolve` | — | 置 resolved（非 resolved 才更新） |

### 2.5.2 核心算法 / 流程

- **指标聚合（upsert_metric）**：`INSERT ... ON DUPLICATE KEY UPDATE`，按主键 `(tenant_id, bucket_ts, source)` 累加 events/success/failed，分位 `COALESCE(VALUES(...), 旧值)` 取最新非空——同一桶可被采集端多次增量写入。
- **总览（overview）**：对近 `window_minutes` 的桶 `SUM` 计数、`AVG` 分位；`success_rate = success/total*100`、`error_rate = failed/total*100`（total=0 时返回 null 避免除零）。`window_minutes` 钳制在 `[1, 43200]`。
- **投递分组统计（delivery_stats）**：`group_by` 经白名单常量映射（status/source/destination/event_name），非法值抛 400；列名来自常量而非用户串拼接，规避注入。
- **规则评估（evaluate_rule）**：取规则窗口 → 调 `overview`（scope=specific_source 时按 source 过滤）→ 从 `{success_rate, error_rate, event_count, latency_p95}` 取指标值 → `_compare(value, operator, threshold)`（lt/lte/gt/gte/eq）判越界 → `breached && fire` 时落 `monitor_alert_event`，`detail` 内嵌 overview 快照。
- **告警生命周期**：triggered → acknowledge（记 acknowledged_at/by，仅 triggered 可确认）→ resolve（记 resolved_at，非 resolved 即可）。
- **JSON 字段**：`channel_config`/`detail` 写入 `json.dumps(..., ensure_ascii=False)` 保中文，读出经 `_loads` 反序列化。

### 2.5.3 与其他模块依赖

- **执行器**：复用 `executor.MysqlOlapExecutor` 的连接配置，与全局存储解耦约定一致（不自建连接串）。
- **采集上游（接真起点）**：`POST /monitor/metrics`、`POST /monitor/delivery-logs` 供入库路径 `POST /events/process`、`POST /etl/import` 及 id-mapping `merge_log` 打点写入；当前由模拟/采集端调用，尚无自动埋点中间件。
- **01-Connections Destinations**：`event_delivery_log.destination/status/http_code` 语义对应 Destinations 投递结果，需投递侧回写；Monitor 仅做读侧聚合展示。
- **前端**：`pages/segment/` 的 DeliveryPage/AlertsPage/EventLogsPage 仍读 `mock/data.ts`，待按 2.4 字段映射切到上列端点。

## 3. 技术设计

### 3.1 前端

- **现有 Mock 页**：三个页面均为纯展示组件，从 `mock/data.ts` 读取静态对象，无状态管理、无请求。
- **复用 kit**：`StatCards`（指标卡）、`Sparkline`（趋势图）、`MockTag`（角标）来自 `components/segment/kit.tsx`；表格用 `components/ui` 的 `DataTable`，布局用 `Layout`。
- **接真改造**：引入数据请求层（与其余真实页一致走 `/api/*`），把 `deliveryMetrics`/`sourcesHealth`/`alerts`/`eventLogs` 替换为对应端点返回；趋势图 `series[]` 直接喂给 `Sparkline`。Alerts 页补「新建/编辑」表单（当前仅有按钮）。摘掉 `MockTag` 作为接真完成标志。

### 3.2 后端

> 已落地：`services/sql-engine/monitor_api.py`（`MonitorService` + `APIRouter`），19 个端点见 2.5.1。以下为现状与剩余待建项。

- **聚合存储（已建）**：4 张表落库（2.4），`monitor_metrics` 用 MySQL 聚合表 + 索引满足近24h/趋势查询，未引入独立时序库。
- **指标/日志/告警端点（已建）**：总览、时序、upsert、数据源汇总、投递日志读写、分组统计、规则 CRUD、规则评估、触发记录确认/解决全部就绪并通过 pytest。
- **规则评估引擎（已建，半自动）**：`POST /monitor/alert-rules/{id}/evaluate` 按窗口聚合判越界并落触发记录；**周期调度 + 通知下发（邮件/飞书 webhook）仍待建**——当前需外部定时调用 evaluate，命中后不自动发通知。
- **指标采集中间件（待建）**：尚无自动埋点；需在入库路径 `POST /events/process`、`POST /etl/import`（及 id-mapping `merge_log`）包一层打点，调用 `POST /monitor/metrics`、`POST /monitor/delivery-logs` 写入。

### 3.3 真实 vs Mock 边界

| 区块 | 后端 | 前端 | 说明 |
|------|------|------|------|
| 投递概览 KPI | ✅ 真实 `GET /monitor/overview` | Mock | 表/端点就绪，前端待切 |
| 趋势图 series | ✅ 真实 `GET /monitor/metrics`（按桶升序） | Mock | 直接喂 `Sparkline` |
| 数据源健康 | ✅ 真实 `GET /monitor/sources` | Mock | 按 source 汇总 + 成功率 |
| 告警规则 | ✅ 真实 CRUD `/monitor/alert-rules` | Mock（含按钮无表单） | 前端待补新建/编辑表单 |
| 告警触发与生命周期 | ✅ 真实 `/monitor/alert-events` + ack/resolve | Mock | 评估引擎已可判越界落库 |
| 事件投递日志 | ✅ 真实 `/monitor/delivery-logs` + `delivery-stats` | Mock | dest/http_code 待 Destinations 回写真实值 |
| 指标自动采集 | ⛔ 待建（无埋点） | — | 现靠采集端手动 POST；可先映射 `merge_log` 试跑 |
| 告警周期调度 + 通知下发 | ⛔ 待建 | — | evaluate 已可手动触发，缺定时器与邮件/飞书发送 |

### 3.4 依赖与集成

- **埋点采集点**：`POST /etl/import`（批量导入）、`POST /events/process`（单事件入库）—— 在此统计吞吐/成功率/时延；id-mapping `GET /merge-log/{tenant}` 作为现成事件流。
- **日志与 Destinations 关联**：事件投递日志的 `dest` + `status` + `http_code` 依赖 **01-Connections 的 Destinations** 投递结果；需在投递侧回写每事件到目的地的状态，Monitor 仅做读侧聚合与展示。
- **多租户**：所有指标/日志/规则按 `tenant_id` 隔离，前端顶栏 Workspace 切换（1001/1002）。

## 4. TODOs

**已完成（本轮）**

- ✅ [数据] 建 `monitor_metrics` / `monitor_alert_rule` / `monitor_alert_event` / `event_delivery_log` 四表（`sql/migrate_modules.sql`）。
- ✅ [后端] `monitor_api.py`：总览/时序/upsert/数据源汇总、投递日志读写 + 分组统计、告警规则 CRUD、规则评估、触发记录确认/解决，共 19 端点；pytest 全局 411P/0F/2S。

**P0（前端接真）**

- [前端] `DeliveryPage` 接 `GET /monitor/overview` + `/monitor/metrics` + `/monitor/sources`（指标卡 + `Sparkline` + 数据源表），摘 `MockTag`。
- [前端] `EventLogsPage` 接 `GET /monitor/delivery-logs`（按 source/dest/status 过滤），摘 `MockTag`。
- [前端] `AlertsPage` 补「新建/编辑告警」表单（对接 POST/PUT `/monitor/alert-rules`），展示真实触发记录（`/monitor/alert-events`）+ ack/resolve 操作。

**P1（采集自动化）**

- [数据] 在 `POST /events/process` / `POST /etl/import` 加埋点中间件，自动调用 `POST /monitor/metrics` + `/monitor/delivery-logs`；可先映射 id-mapping `merge_log` 试跑吞吐/日志。

**P2（告警闭环）**

- [后端] 告警评估周期调度器（定时遍历启用规则调 evaluate）+ 通知渠道下发（邮件/飞书 webhook，读 `channel`/`channel_config`）。
- [后端] 与 01-Connections Destinations 集成，回写每事件→目的地真实投递状态（dest/status/http_code）到 `event_delivery_log`。
