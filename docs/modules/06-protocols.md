# 模块 06 · 协议 Protocols

> 状态：后端已落地（4 表 + 19 端点，含校验闭环） · 前端待接 API · 入库钩子待建 · 对标 Segment Protocols
>
> 本轮进展：`tracking_plans` / `tracking_plan_events` / `violations` / `transformations` 四表**已建**（`sql/migrate_modules.sql`），新增自包含路由 `services/sql-engine/protocols_api.py`（`APIRouter`，prefix `/protocols`，已在 `main.py` 注册），实现埋点计划 / 计划事件 / 违规 / 转换 的完整 CRUD，以及 `validate_event` 校验函数（声明 / 必填 / 类型校验 + 违规自动 upsert）。全局验收 pytest 411P / 0F / 2S。仍待建：前端接 API、入库前钩子（`/etl/import`、`/events/process`）。

## 1. 概述

协议 Protocols 是 CDP 的**数据治理层**，对标 Twilio Segment Protocols。它定义「数据应该长什么样」（埋点计划 / Tracking Plan），在事件**入库前**对照计划做 schema 校验，把不符合规范的上报记为**违规 Violations**，并通过**转换 Transformations** 在入库前改写 payload（重命名 / 删除 / 值映射），从而统一下游数据口径、保证数据质量。

本模块**后端已落地**：四张表已建、19 个 CRUD 端点已注册、`validate_event` 校验函数（声明/必填/类型校验 + 违规自动 upsert）已实现（详见 2.4 / 2.5）。**前端三页仍为 Mock**（右上角有「Mock 数据」角标，读 `mock/data.ts`），尚未接 API。**入库前钩子仍待建**——把 Tracking Plan 校验作为既有两条真实入库链路（ETL `POST /etl/import`、实时事件 `POST /events/process`）的入库前钩子，是后续核心工作；转换的入库执行（payload 改写）也未实现。

- 对标 Segment 的哪块：Protocols（Tracking Plans / Violations / Transformations）。
- 真实/Mock 状态：**后端真实（表 + CRUD + 校验）**，前端 Mock，入库钩子/转换执行待建。
- 价值定位：数据质量是 CDP 的地基，违规数据会污染 Unify（OneID）与 Engage（圈人/触达）。

## 2. 详细设计（产品）

### 2.1 子功能清单

| 功能 | 英文 | 状态 | 说明 |
|------|------|------|------|
| 埋点计划 | Tracking Plans | 后端已建 / 前端 Mock | 多份计划 CRUD，每份绑定数据源（`sources`）；前端页待接 API |
| 事件 Schema | Event Schema | 后端已建 / 前端 Mock | 计划内逐事件定义类型（track/identify）、属性、必填项、审批状态；CRUD 已通 |
| 数据质量违规 | Violations | 后端已建 / 前端 Mock | 按「事件+问题」聚合，校验失败自动 upsert；列表支持 severity/source 过滤 |
| 数据转换 | Transformations | 后端 CRUD 已建 | 规则可存（rename/delete/mapping）；入库执行（payload 改写）待建 |
| 载荷校验 | Validate | 后端已建 | `/tracking-plans/{plan_id}/validate`：对照 schema 校验并记违规 |
| 入库校验钩子 | Validation Hook | 待建 | 把校验抽成挂在 `/etl/import` 与 `/events/process` 入库前的中间件 |
| 计划审批流 | Plan Approval | 部分（仅状态字段） | 事件 schema 有 `status` draft→approved 字段，无流转逻辑 |

### 2.2 信息架构与页面

| 路由 | 页面文件 | 说明 | 状态 |
|------|---------|------|------|
| `/protocols` | `frontend/src/pages/segment/TrackingPlansPage.tsx` | 埋点计划列表 + 事件 Schema 表 | Mock |
| `/protocols/violations` | `frontend/src/pages/segment/ViolationsPage.tsx` | 数据质量违规列表 | Mock |
| `/protocols/transformations` | `frontend/src/pages/segment/TransformationsPage.tsx` | 数据转换列表，含「新建转换」按钮（无逻辑） | Mock |

导航定义于 `frontend/src/lib/nav.ts`（「协议 / Protocols」分组），路由注册于 `frontend/src/App.tsx`（第 90–92 行）。三页均通过 `components/segment/kit.tsx` 的 `MockTag` 在右上角标注 Mock。

### 2.3 关键用户流程

写入治理闭环：**定义埋点计划 → 事件入库时校验 → 产生违规 → 转换修复**。

1. **定义埋点计划**：数据治理员在 `/protocols` 新建计划（如「电商核心埋点」），绑定数据源（Web/App/小程序），逐事件定义 schema——事件名、类型（track/identify）、属性列表、必填属性、审批状态（草稿→已批准）。
2. **事件入库时校验**：上游通过 ETL（`POST /etl/import`）或实时事件（`POST /events/process`）上报。入库**前**，校验钩子按该数据源所绑定计划的事件 schema 逐条校验：事件是否声明、必填属性是否齐全、属性类型是否匹配、是否存在未声明属性。
3. **产生违规**：校验失败的事件按「事件 + 问题」聚合写入 `violations`（累加 `count`、更新 `last_seen`），按 high/low 分级，呈现在 `/protocols/violations`。校验策略可配置为「仅告警放行」或「阻断」。
4. **转换修复**：治理员在 `/protocols/transformations` 配置转换（如 `amount → order_amount` 重命名、丢弃 PII、渠道值归一化），按作用范围（某事件 / 所有事件）在入库前改写 payload，使后续上报符合计划、消除违规。

### 2.4 数据模型（四表 已建）

四表均已写入 `sql/migrate_modules.sql`（`CREATE TABLE IF NOT EXISTS`，`ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`），经 `scripts/apply_migrations.sh` 应用到 MySQL `:3308`，全部含 `tenant_id` 并按工作区隔离。以下为真实 DDL 要点。

**`tracking_plans` 埋点计划 · 已建**

| 列 | 类型 | 约束/默认 | 说明 |
|----|------|----------|------|
| `id` | BIGINT | PK, AUTO_INCREMENT | 主键 |
| `tenant_id` | BIGINT | NOT NULL | 工作区隔离 |
| `name` | VARCHAR(128) | NOT NULL | 计划名 |
| `description` | VARCHAR(512) | | 描述 |
| `sources` | JSON | | 数据源列表，如 `["app","web","小程序"]` |
| `enabled` | TINYINT | DEFAULT 1 | 启用标志 |
| `created_at` / `updated_at` | DATETIME | 默认/ON UPDATE 当前时间 | 时间戳 |

- 唯一键 `uk_tenant_name (tenant_id, name)`（同租户计划名唯一）；索引 `idx_tenant (tenant_id)`。

**`tracking_plan_events` 埋点计划事件 schema · 已建**

| 列 | 类型 | 约束/默认 | 说明 |
|----|------|----------|------|
| `id` | BIGINT | PK, AUTO_INCREMENT | 主键 |
| `tenant_id` | BIGINT | NOT NULL | 工作区隔离 |
| `plan_id` | BIGINT | NOT NULL | 所属计划 |
| `event` | VARCHAR(128) | NOT NULL | 事件名，如 `Order Completed` |
| `type` | ENUM('track','identify') | NOT NULL DEFAULT 'track' | 事件类型 |
| `properties_json` | JSON | | `{"property_name":"type",...}` 属性与类型 |
| `required` | JSON | | `["必填属性1",...]` 必填项 |
| `status` | ENUM('draft','approved') | DEFAULT 'draft' | 审批状态 |
| `created_at` / `updated_at` | DATETIME | 默认/ON UPDATE | 时间戳 |

- 唯一键 `uk_plan_event (plan_id, event)`（同计划内事件名唯一）；索引 `idx_plan (tenant_id, plan_id)`、`idx_event (tenant_id, event)`。

**`violations` 数据质量违规聚合 · 已建**

| 列 | 类型 | 约束/默认 | 说明 |
|----|------|----------|------|
| `id` | BIGINT | PK, AUTO_INCREMENT | 主键 |
| `tenant_id` | BIGINT | NOT NULL | 工作区隔离 |
| `event` | VARCHAR(128) | NOT NULL | 被违规的事件名 |
| `issue` | VARCHAR(256) | NOT NULL | 问题描述 |
| `count` | INT | DEFAULT 1 | 累计出现次数 |
| `source` | VARCHAR(64) | | 数据来源 |
| `severity` | ENUM('high','low') | DEFAULT 'low' | 严重级别 |
| `first_seen` | DATETIME | 默认当前时间 | 首次出现 |
| `last_seen` | DATETIME | 默认/ON UPDATE | 最近出现 |
| `created_at` | DATETIME | 默认当前时间 | 创建时间 |

- 唯一键 `uk_tenant_event_issue (tenant_id, event, issue)`（支撑「事件+问题」聚合 upsert）；索引 `idx_tenant`、`idx_severity (tenant_id, severity)`、`idx_source (tenant_id, source)`、`idx_last_seen (last_seen)`。

**`transformations` 事件转换规则 · 已建**

| 列 | 类型 | 约束/默认 | 说明 |
|----|------|----------|------|
| `id` | BIGINT | PK, AUTO_INCREMENT | 主键 |
| `tenant_id` | BIGINT | NOT NULL | 工作区隔离 |
| `name` | VARCHAR(128) | NOT NULL | 转换规则名 |
| `scope` | VARCHAR(128) | | 作用范围：某事件或 `all_events` |
| `type` | ENUM('rename','delete','mapping') | NOT NULL DEFAULT 'rename' | 转换类型（重命名/删除/值映射） |
| `config` | JSON | | 规则配置 |
| `enabled` | TINYINT | DEFAULT 1 | 启用标志 |
| `description` | VARCHAR(512) | | 描述 |
| `created_at` / `updated_at` | DATETIME | 默认/ON UPDATE | 时间戳 |

- 索引 `idx_tenant`、`idx_scope (tenant_id, scope)`、`idx_enabled (tenant_id, enabled)`。

> 删除计划时（`delete_plan`）会先级联删除该计划下的 `tracking_plan_events` 再删计划本身（应用层两步删除，非 FK 约束）。

## 2.5 逻辑设计（后端已落地）

后端为**自包含路由** `services/sql-engine/protocols_api.py`（Pydantic 模型 + `ProtocolsService` + `APIRouter`，变量名 `router`，prefix `/protocols`，tags `["protocols"]`），在 `main.py` 第 55 行 `import`、第 504 行 `app.include_router(protocols_router)` 注册。不修改 `schemas.py` / `objects.py` / 既有 service，纯加法。所有 SQL 参数化，所有读写带 `tenant_id`（统一通过 query 参数 `tenant_id` 传入）。`ProtocolsService` 复用 `executor.MysqlOlapExecutor` 的 `config` 自建 `pymysql` 连接（`autocommit=True`，`contextmanager` 管理）。

### 2.5.1 端点列表

经网关访问统一加 `/api` 前缀（nginx 转发到 sql-engine 时剥离），下表为 sql-engine 内真实路径。所有端点均需 query 参数 `tenant_id`（int，必填）。

| 方法 | 路径 | 请求体/参数 | 响应 |
|------|------|------------|------|
| GET | `/protocols/tracking-plans` | — | 计划列表（`sources` 已 JSON 解析） |
| POST | `/protocols/tracking-plans` | `TrackingPlanCreate{name, description?, sources?[], enabled=true}` | 新建计划行 |
| GET | `/protocols/tracking-plans/{plan_id}` | — | 单个计划；不存在 404 |
| PUT | `/protocols/tracking-plans/{plan_id}` | `TrackingPlanUpdate{name?, description?, sources?, enabled?}` | 更新后计划；不存在 404 |
| DELETE | `/protocols/tracking-plans/{plan_id}` | — | `{deleted:true, id}`；级联删事件；不存在 404 |
| GET | `/protocols/tracking-plans/{plan_id}/events` | — | 该计划事件 schema 列表（`properties_json`/`required` 已解析） |
| POST | `/protocols/tracking-plans/{plan_id}/events` | `PlanEventCreate{event, type='track', properties_json?, required?[], status='draft'}` | 新建事件；计划不存在 404 |
| PUT | `/protocols/tracking-plans/events/{event_id}` | `PlanEventUpdate{event?, type?, properties_json?, required?, status?}` | 更新后事件；不存在 404 |
| DELETE | `/protocols/tracking-plans/events/{event_id}` | — | `{deleted:true, id}`；不存在 404 |
| POST | `/protocols/tracking-plans/{plan_id}/validate` | `ValidateRequest{event, properties{}, source?, record_violation=true}` | `{valid, event, issues[], recorded_violations[]}`；计划不存在 404 |
| GET | `/protocols/violations` | query `severity?`、`source?`、`limit=100`（夹取 1–500） | 违规列表，按 `last_seen` 倒序 |
| POST | `/protocols/violations` | `ViolationRecord{event, issue, count=1, source?, severity='low'}` | upsert 后的违规行 |
| DELETE | `/protocols/violations/{violation_id}` | — | `{deleted:true, id}`；不存在 404 |
| GET | `/protocols/transformations` | query `scope?` | 转换规则列表（`config` 已解析） |
| POST | `/protocols/transformations` | `TransformationCreate{name, scope?, type='rename', config?, enabled=true, description?}` | 新建转换行 |
| GET | `/protocols/transformations/{tf_id}` | — | 单个转换；不存在 404 |
| PUT | `/protocols/transformations/{tf_id}` | `TransformationUpdate{name?, scope?, type?, config?, enabled?, description?}` | 更新后转换；不存在 404 |
| DELETE | `/protocols/transformations/{tf_id}` | — | `{deleted:true, id}`；不存在 404 |

> 共 19 个端点（PUT 事件、DELETE 事件用 `/tracking-plans/events/{event_id}` 扁平路径，不带 `plan_id`）。

### 2.5.2 核心算法 / 流程

**校验 `validate_event(tenant_id, plan_id, req)`**（`POST /protocols/tracking-plans/{plan_id}/validate` 的内核）：

1. 按 `(tenant_id, plan_id, event)` 取该计划下目标事件的 schema。
2. 逐项校验生成 `issues`：
   - 事件未在计划中声明 → `事件未在埋点计划中定义（Unplanned Event）`。
   - 必填属性缺失（`required` 中字段不在 `properties`）→ `缺少必填属性: {field}`。
   - 属性类型不符 → `属性 {field} 类型不符，应为 {expected}`。类型校验由 `_type_ok` 完成，支持 `string/number/int/float/boolean/array/object` 等映射；未知类型不强校验；`bool` 因是 `int` 子类被显式排除（避免布尔被当整数放过）。
3. `valid = len(issues)==0`。若不合规且 `record_violation=True`，对每条 issue 调 `record_violation` 落库：`缺少必填` 或 `未在埋点计划` 判 `high`，其余 `low`。
4. 返回 `{valid, event, issues, recorded_violations}`。

**违规聚合 `record_violation`**：`INSERT ... ON DUPLICATE KEY UPDATE`，依赖唯一键 `uk_tenant_event_issue (tenant_id, event, issue)`——同「事件+问题」存在则 `count = count + VALUES(count)` 并刷新 `source/severity/last_seen`，否则新建。

**JSON 出入**：写入时 `json.dumps(..., ensure_ascii=False)` 保中文；读出时 `_loads` 把 `sources`/`properties_json`/`required`/`config` 反序列化为对象再返回。

### 2.5.3 与其他模块依赖

- **当前实现**：仅依赖 `executor.MysqlOlapExecutor`（取 MySQL 连接配置），不依赖其他 service，可独立运行。
- **规划集成（待建）**：校验/转换钩子接入既有真实入库链路——ETL `POST /etl/import`（`etl.py::run_import`）与实时事件 `POST /events/process`（`id-mapping`）。详见 3.4。
- **下游影响**：治理质量影响 Unify（02）OneID 准确性、Engage（03）圈人触达精度；与 Privacy（05）在「属性删除/哈希」转换上可共享执行层。

## 3. 技术设计

### 3.1 前端（现有 Mock 页与组件）

- **页面**：`TrackingPlansPage.tsx` / `ViolationsPage.tsx` / `TransformationsPage.tsx`，均位于 `frontend/src/pages/segment/`。
- **数据源**：`frontend/src/mock/data.ts` 导出 `trackingPlans`（name/events/sources/conformance/updated）、`trackingEvents`（event/type/properties/required/status）、`violations`（event/issue/count/source/severity）、`transformations`（name/scope/type/status）。
- **UI 套件**：`components/ui.tsx`（`Card`/`DataTable`/`Button`）、`components/segment/kit.tsx`（`StatCards`/`MockTag`）。
- **现状**：纯静态渲染，无任何请求、无表单逻辑（「新建转换」按钮无 onClick）。接真时改为从 `/api/protocols/*` 拉数，并补建计划/事件/转换的编辑表单。

### 3.2 后端（已落地：服务 + 19 端点 + 校验函数）

落在 `services/sql-engine/protocols_api.py`（自包含路由），已在 `main.py` 注册。端点清单、请求/响应、校验与聚合算法见 **2.5 逻辑设计**。实际路由前缀为 `/protocols/tracking-plans`（非早期草拟的 `/protocols/plans`）。

| 端点组 | 方法 | 状态 | 说明 |
|------|------|------|------|
| `/protocols/tracking-plans` | GET/POST | 已建 | Tracking Plans 列表/新建 |
| `/protocols/tracking-plans/{plan_id}` | GET/PUT/DELETE | 已建 | 单计划查/改/删（删带级联） |
| `/protocols/tracking-plans/{plan_id}/events` | GET/POST | 已建 | 计划内事件 schema 列表/新建 |
| `/protocols/tracking-plans/events/{event_id}` | PUT/DELETE | 已建 | 事件 schema 改/删 |
| `/protocols/tracking-plans/{plan_id}/validate` | POST | 已建 | 载荷对照 schema 校验 + 自动记违规 |
| `/protocols/violations` | GET/POST | 已建 | 违规列表（tenant/severity/source 过滤）/手动上报 |
| `/protocols/violations/{violation_id}` | DELETE | 已建 | 删违规 |
| `/protocols/transformations` | GET/POST | 已建 | Transformations 列表/新建 |
| `/protocols/transformations/{tf_id}` | GET/PUT/DELETE | 已建 | 单转换查/改/删 |

**校验函数（核心，已实现）**：`ProtocolsService.validate_event(tenant_id, plan_id, req)`，校验「事件已声明 / 必填齐全 / 类型匹配」，不合规 upsert `violations`（累加 `count`、刷新 `last_seen`）。流程详见 2.5.2。

**入库前钩子（仍待建）**：现有 `validate_event` 以 `plan_id` 为入参、经显式 `/validate` 端点调用；尚未抽成「按 `source` 自动定位计划」的入库中间件，也未接入 `etl.py::run_import` / `events/process`，转换的入库执行（`transformations` 改写 payload）也未实现。详见 3.4 与 TODOs。

### 3.3 真实 vs Mock 边界

| 部分 | 现状 | 待补 |
|------|------|------|
| 四张表（计划/事件/违规/转换） | **真实**（MySQL `:3308`，已建） | — |
| CRUD 端点（计划/事件/违规/转换，共 19 个） | **真实**（`protocols_api.py`，已注册） | — |
| 载荷校验 `validate_event` + 违规聚合 | **真实**（声明/必填/类型校验 + upsert violations） | — |
| 三个前端页面渲染 | Mock（静态，读 `mock/data.ts`，带 `MockTag`） | 改读 `/api/protocols/*`，移除 `MockTag` |
| 计划/事件/转换编辑表单 | 无（「新建转换」按钮无 onClick） | 补建增删改表单 |
| 入库前钩子（自动定位计划） | 无（仅显式 `/validate` 端点，需传 `plan_id`） | 抽成按 `source` 定位计划的中间件 |
| 接入真实入库链路 | 无（事件仍直接入库） | 接 `etl.py::run_import`、`events/process` |
| 转换执行（payload 改写） | 无（仅存规则，不执行） | 入库前应用启用中的 transformations |

**边界关键点**：本模块后端的 CRUD 与校验已为真实数据层；剩余「真实化」的核心是把校验/转换**插入既有真实入库链路**（ETL / 实时事件）并让前端接上 API——这是与纯 Mock 模块最大的不同。

### 3.4 依赖与集成（与 ETL 导入 / 事件接入的校验集成点）

- **ETL 导入**：`POST /etl/import`（`services/sql-engine/etl.py` 的 `run_import`，逐行 upsert 到目标对象）。集成点：在逐行 upsert **前**对每行调用 `validate_event` + 应用 transformations；违规行可按策略跳过或记违规后放行。前端入口 `frontend/src/api/client.ts` 第 93 行。
- **实时事件**：`POST /events/process`（`services/id-mapping/main.py` 第 507 行，模拟 Flink Job 做 OneID 合并与画像更新）。集成点：在 `process_event` 进入 OneID 合并**前**做校验与转换，避免脏数据污染 OneID 与画像。`/users/import` 批量导入复用同一钩子。
- **多租户**：所有计划/违规/转换查询按 `tenant_id` 隔离，与平台底座一致。
- **下游影响**：治理质量直接影响 Unify（02）的 OneID 准确性与 Engage（03）的圈人/触达精度；与 Privacy（05）的 PII 处理在「属性删除/哈希」上有交集，可共享转换执行层。

## 4. TODOs

### P0（打通最小闭环：能存计划、能校验、能记违规）— 已完成

- [x] [数据] 建表 `tracking_plans` / `tracking_plan_events` / `violations` / `transformations`（含 `tenant_id`），落 MySQL `:3308`。
- [x] [后端] 新建 `services/sql-engine/protocols_api.py`，实现 Tracking Plans 与 Event Schema 的 CRUD 端点。
- [x] [后端] 实现 `validate_event(tenant_id, plan_id, req)` 校验函数（声明/必填/类型/未声明属性）。
- [x] [后端] 违规 upsert 进 `violations`（累加 count、刷新 last_seen），由 `validate_event` 在不合规时自动调用。
- [ ] [后端] 把校验抽成入库前钩子并接入 `etl.py::run_import`（当前仅提供显式 `/validate` 端点，需手传 `plan_id`）。
- [ ] [前端] `/protocols` 与 `/protocols/violations` 改为读 `/api/protocols/tracking-plans`、`/api/protocols/violations`，移除 `MockTag`。

### P1（转换执行 + 实时链路 + 编辑能力）

- [x] [后端] Transformations CRUD（属性重命名/删除/值映射 类型已支持，存规则）。
- [ ] [后端] 转换的入库执行：依规则改写 payload（`rename`/`delete`/`mapping`），可加 `/{id}/run` 调试端点。
- [ ] [后端] 把校验+转换钩子接入 `id-mapping` 的 `/events/process` 与 `/users/import`（OneID 合并前）。
- [ ] [后端] 入库前自动按 `source` 定位绑定计划（现 `validate_event` 以 `plan_id` 为入参）。
- [ ] [前端] 计划/事件/转换的新建与编辑表单（含「新建转换」按钮逻辑）。
- [ ] [前端] `/protocols/transformations` 接 API，支持启用/停用切换。

### P2（治理体验增强）

- [ ] [后端] 校验策略可配（告警放行 / 阻断）+ 事件 schema 审批流（草稿→已批准）。
- [ ] [数据] 违规趋势与合规率随时间统计，支撑监控（06）联动。
- [ ] [前端] 违规详情下钻、按来源/级别过滤、一键生成修复转换。
- [ ] [后端] 与 Privacy（05）共享转换执行层，统一 PII 删除/哈希逻辑。
