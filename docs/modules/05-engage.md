# 模块 05 · 触达 Engage

> 状态：受众列表/圈人/存为受众真实；旅程 Journeys + 群发 Broadcasts 后端 CRUD/状态/统计/触达人数预估已落地（`engage_api.py`），前端仍为 Mock 列表 · 对标 Segment Engage

## 1. 概述

触达 Engage 是 CDP 的「人群运营 + 激活」层，对标 Twilio Segment 的 **Engage**：在统一档案（Unify 的 OneID + 多对象数据）之上圈选人群、保存为可复用的**受众 Audiences**，再通过**旅程 Journeys**（自动化编排）与**群发 Broadcasts**（一次性触达）把人群激活到下游目的地。

本模块当前**部分真实**：

- **真实（前端 + 后端）**：受众列表（读 `/segments`）、创建受众（统一筛选器 `UnifiedFilter`：多条件 / 跨对象链式关联 / 边条件 / 自然语言圈人 / 实时预估 / SQL 预览 / 存为受众）。
- **真实（仅后端）**：旅程 Journeys 与群发 Broadcasts 的**全套 CRUD + 状态机字段 + 步骤编排 + 运行状态/统计 + 触达人数预估**，由 `services/sql-engine/engage_api.py`（独立 `APIRouter`，前缀 `/engage`，已在 `main.py` `include_router`）提供，数据落 `journeys`/`journey_steps`/`journey_state`/`broadcasts`/`broadcast_sends` 真实表。**前端尚未接通**，仍展示 `mock/data.ts` 假数据。
- **Mock（前端）**：受众详情（规模趋势、成员明细、连接目的地）、旅程 Journeys、群发 Broadcasts —— 仅 UI + `mock/data.ts` 假数据，右上角带「Mock 数据」角标。
- **未实现（模拟边界）**：旅程编排引擎（状态机推进 `journey_state`）、群发真实外呼第三方（`/broadcasts/{id}/send` 仅把状态置为 `sending` 并记 `sent_at`，不真正发送，也不生成 `broadcast_sends`）、受众规模快照与受众→目的地的写入流程。

圈人能力复用平台底座的 DSL 引擎（`dsl.py` / `objects.py`），与 02-Unify 共享同一套对象元数据与关系图谱；激活能力（Journeys/Broadcasts）依赖 01-Connections 的 Destinations，尚未接通。

## 2. 详细设计（产品）

### 2.1 子功能清单

| 功能 | 英文 | 状态 | 说明 |
|------|------|------|------|
| 受众列表 | Audiences | 真实 | 已保存人群包列表，读 `GET /segments/{tenant_id}`，隐藏 `dsl` 列 |
| 创建受众 | Build Audience | 真实 | `UnifiedFilter` 圈人 → 预估 → 预览 SQL → 存为受众 |
| 多条件筛选 | Conditions | 真实 | 本对象多条件 + AND/OR 逻辑 |
| 跨对象链式关联 | Relations | 真实 | 多条线、正/反向、链式嵌套（relations.relations） |
| 边条件 | Edge Conditions | 真实 | 关系边上的属性过滤（如「通过 app 渠道购买」） |
| 自然语言圈人 | NL → Segment | 真实 | 自然语言 → DSL 草稿 + 预估，可能要求澄清 |
| 实时预估人数 | Estimate | 真实 | `POST /dsl/estimate`，返回命中数 + 耗时 |
| SQL 预览 | SQL Preview | 真实 | 预估/查询返回编译后 SQL，可展开查看 |
| 命中明细 | Search | 真实 | `POST /objects/search`，最多 50 条 |
| 存为受众 | Save as Segment | 真实 | `POST /segments`，落 `segments` 表（含 dsl） |
| 受众详情 | Audience Detail | Mock | 规模趋势、连接目的地（`audienceSample`） |
| 旅程 | Journeys | Mock | 多步骤自动化编排（`journeys`） |
| 群发 | Broadcasts | Mock | 一次性群发 Push/SMS/EDM（`broadcasts`） |

### 2.2 信息架构与页面

| 路由 | 页面文件 | 说明 | 状态 |
|------|---------|------|------|
| `/engage` | `pages/EngagePage.tsx` | 受众列表，读 `/segments` | 真实 |
| `/engage/audiences/new` | `pages/FilterPage.tsx` → `components/filter/UnifiedFilter.tsx` | 创建受众（统一筛选器） | 真实 |
| `/engage/audiences/:id` | `pages/segment/AudienceDetailPage.tsx` | 受众详情：规模趋势、连接目的地 | Mock |
| `/engage/journeys` | `pages/segment/JourneysPage.tsx` | 旅程列表 | Mock |
| `/engage/broadcasts` | `pages/segment/BroadcastsPage.tsx` | 群发列表 | Mock |

组件分层：`FilterPage` 仅是壳，核心在 `UnifiedFilter`，其内嵌 `ConditionEditor`（本对象条件）、`RelationEditor`（跨对象关系 + 边条件 + 链式）、`RelAddButton`（按元数据关系图谱添加关联线）。

### 2.3 关键用户流程

**创建受众（核心闭环）**：

1. **选 base 对象**：默认 `user`，可切换为任意可搜索对象（`OBJECTS` 中 `kind === "object"`）；切换会清空条件与关系。
2. **加本对象条件**：`ConditionEditor` 增删多条 `Leaf{field, op, value}`，并切换 AND/OR；可不加，仅靠跨对象关联筛选。
3. **加跨对象链式关联（多条线）**：点「添加跨对象关联」，按 `meta.relations` 图谱推断关系类型与方向（forward/reverse），每条 `Relation` 可带：
   - `conditions`：关联对象的属性条件；
   - `edge_conditions`：**边条件**，关系边上的属性（如订单渠道 = app）；
   - `relations`：**链式嵌套**，再往下一跳关联（A→B→C）。
4. **自然语言圈人（可选/旁路）**：输入「过去30天有过购买的用户」→ `draftSegment` 返回 DSL 草稿。若 `needs_clarification` 则提示澄清问题；否则回填整条 `rule` 并展示来源/置信度，附带预估。
5. **预估人数**：`runEstimate()` → `estimate()`，展示命中数 + 耗时 + 可展开 SQL。
6. **查询明细**：`runSearch()` → `searchObjects()`，最多 50 条命中行；可配 `rowLink` 跳转详情。
7. **存为受众**：弹窗填「群组编码 + 名称」→ `confirmSegment()`，后端保存前自动校验 + 预估，落 `segments` 表。保存成功后回到 `/engage` 即可见。

### 2.4 数据模型

复用的既有表：

| 表 | 关键字段 | 状态 |
|----|---------|------|
| `segments` | `segment_id`、`tenant_id`、`segment_code`、`segment_name`、`base_object`、`dsl`(JSON 规则)、`estimate`、`source` | 已存在 |
| `user_groups` | `id`、`tenant_id`、`group_code`、`group_name` 等 | 已存在 |
| `user_group_members` | `group_id`、`one_id`（成员明细） | 已存在 |

> `segments` 与 `user_groups` 是两套并行实体：`UnifiedFilter`「存为群组」走 `confirmSegment` → `segments`（含 dsl，可重算）；`groups.py` 是显式成员名单（`one_id` 列表），适合静态人群与成员增删。

本模块新建表（`sql/migrate_modules.sql`，`CREATE TABLE IF NOT EXISTS` + `utf8mb4_unicode_ci`，经 `scripts/apply_migrations.sh` 应用，全部含 `tenant_id` 隔离）—— 真实 DDL 要点：

| 表（注释） | 主键 / 唯一键 | 关键列与类型 | 索引 | 状态 |
|----|----|----|----|----|
| `audience_size_snapshot`（受众规模趋势快照） | PK `snapshot_id` BIGINT AI；UK `uk_segment_time(tenant_id, segment_id, created_at)` | `tenant_id` BIGINT、`segment_id` BIGINT、`segment_code` VARCHAR(64)、`size` INT、`estimate_ms` INT、`created_at` DATETIME | `idx_segment(tenant_id, segment_id)` | 已建（表存在；写入流程未接） |
| `segment_destinations`（受众与目的地关联） | PK `id` BIGINT AI；UK `uk_seg_dest(tenant_id, segment_id, destination_id)` | `destination_id` VARCHAR(64)、`destination_name` VARCHAR(128)、`destination_type` VARCHAR(64)、`status` VARCHAR(32) 默认 `active`、`mapped_at`/`last_sync` DATETIME、`sync_count` INT | `idx_segment(tenant_id, segment_id)` | 已建（表存在；写入流程未接） |
| `journeys`（旅程定义） | PK `journey_id` BIGINT AI；UK `uk_journey_code(tenant_id, journey_code)` | `journey_name` VARCHAR(128)、`description` VARCHAR(512)、`trigger_type` VARCHAR(32)（segment_entry/event/schedule）、`trigger_condition` JSON、`base_segment_id` BIGINT、`visual_config` JSON、`status` VARCHAR(32) 默认 `draft`（draft/active/paused/archived）、`created_by`、`created_at`/`updated_at`（ON UPDATE） | `idx_status(tenant_id, status)` | 已建（CRUD 已用） |
| `journey_steps`（旅程步骤） | PK `step_id` BIGINT AI | `journey_id`、`step_order` INT、`step_type` VARCHAR(32)（action/wait/split/exit）、`step_name`、`action_type`、`destination_id`、`wait_duration_hours` INT、`condition_logic` VARCHAR(32)（and/or）、`conditions` JSON、`next_steps` JSON | `idx_journey(journey_id, tenant_id)`、`idx_order(tenant_id, journey_id, step_order)` | 已建（整组替换式读写已用） |
| `journey_state`（用户旅程运行状态） | PK `state_id` BIGINT AI；UK `uk_journey_one(journey_id, one_id)` | `journey_id`、`one_id` BIGINT、`step_id` BIGINT、`entered_at`/`completed_at` DATETIME、`status` VARCHAR(32) 默认 `active`（active/completed/exited）、`split_condition_result` VARCHAR(64) | `idx_journey(tenant_id, journey_id)`、`idx_one(one_id, journey_id)` | 已建（只读统计已用；编排引擎未写入） |
| `broadcasts`（群发任务） | PK `broadcast_id` BIGINT AI；UK `uk_broadcast_code(tenant_id, broadcast_code)` | `broadcast_name`、`segment_id` BIGINT、`destination_id` VARCHAR(64)、`channel_type` VARCHAR(32)（email/sms/push/wechat）、`subject` VARCHAR(256)、`content_template` TEXT、`estimated_size`/`sent_count`/`bounce_count`/`open_count` INT、`status` VARCHAR(32) 默认 `draft`（draft/scheduled/sending/sent/failed）、`scheduled_at`/`sent_at` DATETIME、`created_by` | `idx_status(tenant_id, status)`、`idx_destination(tenant_id, destination_id)` | 已建（CRUD + send 状态置位已用） |
| `broadcast_sends`（单条群发记录与回执） | PK `send_id` BIGINT AI；UK `uk_broadcast_one(broadcast_id, one_id)` | `broadcast_id`、`one_id` BIGINT、`destination_id`、`channel_type`、`sent_at`/`delivered_at`/`bounced_at`/`opened_at`/`clicked_at` DATETIME、`status` VARCHAR(32) 默认 `pending`（pending/sent/delivered/bounced/opened/clicked）、`error_message` VARCHAR(512) | `idx_broadcast(broadcast_id, tenant_id)`、`idx_destination(tenant_id, destination_id)` | 已建（只读列表/统计已用；发送引擎未写入） |

> 「表存在但写入流程未接」指 DDL 已落库、且后端读取/统计可用，但产生数据的环节（快照定时任务、受众→目的地映射、旅程状态机推进、群发逐条外呼）仍属模拟边界，详见「3.3 真实 vs Mock 边界」与第 4 节 TODOs。

### 2.5 逻辑设计（Journeys / Broadcasts 后端）

实现于 `services/sql-engine/engage_api.py`：独立 `APIRouter(prefix="/engage", tags=["engage"])`，在 `main.py` 第 503 行 `app.include_router(engage_router)` 装载。Pydantic 模型就地定义（不动 `schemas.py`）；`EngageService` 自行实例化（不动 `main.py` 的依赖注入），通过 `MysqlOlapExecutor().config` 取 `pymysql` 连接，全部参数化 SQL，JSON 列统一 `json.dumps(ensure_ascii=False)` 入库、读出时 `_normalize` 反序列化。经网关 `/api` 前缀对外暴露为 `/api/engage/*`。

#### 端点清单

| Method | Path | 请求 | 响应 |
|--------|------|------|------|
| GET | `/engage/journeys` | query `tenant_id`(必)、`status`(可) | 旅程列表（按 `journey_id` 倒序） |
| POST | `/engage/journeys` | body `JourneyCreate`（`tenant_id`、`journey_code`、`journey_name`、`description`、`trigger_type`、`trigger_condition`、`base_segment_id`、`visual_config`、`status`、`created_by`） | 新建旅程行；`journey_code` 冲突 → 409 |
| GET | `/engage/journeys/{journey_id}` | query `tenant_id` | 旅程详情（含 `steps` 数组）；不存在 → 404 |
| PUT | `/engage/journeys/{journey_id}` | query `tenant_id` + body `JourneyUpdate`（部分字段，`exclude_unset`） | 更新后的旅程详情；不存在 → 404 |
| POST | `/engage/journeys/{journey_id}/status` | query `tenant_id` + body `{status}` | 改状态后的详情；不存在 → 404 |
| DELETE | `/engage/journeys/{journey_id}` | query `tenant_id` | `{deleted, journey_id}`；级联删 steps/state |
| GET | `/engage/journeys/{journey_id}/steps` | query `tenant_id` | 步骤列表（按 `step_order, step_id`） |
| PUT | `/engage/journeys/{journey_id}/steps` | body `JourneyStepsReplace`（`tenant_id` + `steps[]`） | 整组替换后步骤列表；旅程不存在 → 404 |
| GET | `/engage/journeys/{journey_id}/state` | query `tenant_id`、`status`(可)、`limit`(默认 50，封顶 500) | 运行状态行（按 `entered_at` 倒序） |
| GET | `/engage/journeys/{journey_id}/stats` | query `tenant_id` | `{total, active, completed, exited, by_status}` |
| GET | `/engage/broadcasts` | query `tenant_id`、`status`(可) | 群发列表（倒序） |
| POST | `/engage/broadcasts` | body `BroadcastCreate`（`tenant_id`、`broadcast_code`、`broadcast_name`、`segment_id`、`destination_id`、`channel_type`、`subject`、`content_template`、`estimated_size`、`scheduled_at`、`created_by`） | 新建群发行；`broadcast_code` 冲突 → 409 |
| GET | `/engage/broadcasts/{broadcast_id}` | query `tenant_id` | 群发详情；不存在 → 404 |
| PUT | `/engage/broadcasts/{broadcast_id}` | query `tenant_id` + body `BroadcastUpdate`（部分字段） | 更新后的群发详情；不存在 → 404 |
| DELETE | `/engage/broadcasts/{broadcast_id}` | query `tenant_id` | `{deleted, broadcast_id}`；级联删 sends |
| POST | `/engage/broadcasts/{broadcast_id}/send` | query `tenant_id` | 将 `status` 置 `sending` 并记 `sent_at`（**模拟，不外呼第三方、不生成 sends**）；不存在 → 404 |
| GET | `/engage/broadcasts/{broadcast_id}/sends` | query `tenant_id`、`status`(可)、`limit`(默认 100，封顶 500) | 逐条发送/回执列表（按 `send_id` 倒序） |
| GET | `/engage/broadcasts/{broadcast_id}/stats` | query `tenant_id` | 聚合 `{total, sent, delivered, bounced, opened, clicked, opened_any, clicked_any}` |
| POST | `/engage/estimate-audience` | body `AudienceEstimateRequest`（`tenant_id` + `dsl` 或 `segment_code` 二选一） | DSL 预估结果（命中数 + 耗时 + SQL） |

#### 核心算法 / 流程

- **租户隔离**：所有读写 SQL 均带 `WHERE tenant_id=%s`；唯一键 `uk_journey_code`/`uk_broadcast_code` 含 `tenant_id`，编码在租户内唯一、跨租户可重名。
- **部分更新**：`update_journey`/`update_broadcast` 用列白名单 `column_map` 动态拼 `SET` 子句（仅列名来自白名单、值始终参数化），`data.get(key) is not None` 决定是否纳入；JSON 列单独 `dumps`。无可更新字段时直接回读当前行。
- **状态置位幂等**：`set_journey_status` 在 `rowcount==0`（状态未变化）时再 `SELECT` 确认旅程是否存在，区分「无变化」与「不存在(404)」。
- **步骤整组替换**：`replace_steps` 先 `DELETE` 该旅程全部步骤再批量 `INSERT`（先校验旅程存在），避免增量 diff 的复杂度；`conditions`/`next_steps` 以 JSON 存储，支持分流/下一跳编排。
- **删除级联**：删旅程同时清 `journey_steps`、`journey_state`；删群发同时清 `broadcast_sends`（应用层级联，非外键）。
- **统计聚合**：`journey_stats` 按 `journey_state.status` `GROUP BY` 计数；`broadcast_stats` 用 `SUM(status='...')` 与 `SUM(opened_at IS NOT NULL)` 等布尔聚合一次性算出漏斗指标。
- **触达人数预估（关键安全边界）**：`estimate-audience` 拿到 `dsl`（或按 `segment_code` 经 `SegmentService.get` 取回受众的 dsl），补 `tenant_id` 后交给 `DslEngine.estimate` —— **复用平台底座 DSL→`objects.build_sql` 路径，绝不手拼 SQL、绝不让 LLM 直出 SQL**；`ObjectError` → 400。

#### 与其他模块依赖

- **平台底座 DSL 引擎**（`dsl.DslEngine` + `objects.ObjectService`）：触达人数预估走 `estimate`，与圈人同一条编译/预估链路。
- **02-Unify**：旅程/群发以 OneID（`one_id`）为触达主体，受众条件复用 Unify 的对象元数据与关系图谱。
- **本模块 `SegmentService`**：`estimate-audience` 按 `segment_code` 回取受众 dsl；`base_segment_id`/`segment_id` 外键式引用 `segments`。
- **01-Connections（待接）**：`destination_id`/`channel_type` 预留指向 Destinations；真实发送与回执（`broadcast_sends`）需对接其发送通道，当前为模拟边界。

## 3. 技术设计

### 3.1 前端

**`UnifiedFilter` 能力**：单一组件覆盖「圈人全流程」，支持 props `baseObject`（预置对象）、`lockBase`（锁定不可换）、`autoSearch`（元数据就绪自动查一次）、`rowLink`（明细行跳转）—— 既用于 `/engage/audiences/new`，也可复用于对象列表页。

**状态（useState）**：`meta`(元数据)、`rule`(当前 DSL)、`nl`/`nlMsg`(自然语言)、`busy`(进行中动作)、`est`({n, ms, sql})、`rows`(明细)、`showSql`、`err`、`saveOpen`/`saveCode`/`saveName`/`saveMsg`(存为群组弹窗)。

**调用的 api 函数**（`api/client.ts`）：

| 动作 | 函数 | 后端端点 |
|------|------|---------|
| 加载元数据 | `getMetadata(tenant)` | `GET /metadata`（Unify 共享） |
| 自然语言草稿 | `draftSegment(tenant, question)` | `POST /agent/segment/draft` |
| 预估人数 | `estimate(tenant, rule)` | `POST /dsl/estimate` |
| 查询明细 | `searchObjects({...})` | `POST /objects/search` |
| 存为受众 | `confirmSegment(tenant, code, name, rule)` | `POST /agent/segment/confirm` → `segments` |
| 列表 | `listSegments(tenant)` | `GET /segments/{tenant_id}` |
| 校验 | `validateRule` | `POST /dsl/validate` |

**DSL 类型**（`api/types.ts`）：

```ts
DslRule { object: string; logic: "AND"|"OR"; conditions: Leaf[]; relations: Relation[] }
Relation { rel_type; object; direction: "forward"|"reverse";
           conditions: Leaf[]; edge_conditions: Leaf[]; relations: Relation[] /* 链式 */ }
Leaf { field; op; value }
```

`rule` 与 `Relation` 同构（都含 `conditions` + `relations`），因此天然支持任意深度的跨对象链式嵌套。

### 3.2 后端（`services/sql-engine/`）

| 端点 | 表/模块 | 状态 |
|------|--------|------|
| `GET /segments/{tenant_id}`、`GET /segments/{tenant_id}/{segment_code}` | `segments`（`segments.py`） | 已实现 |
| `POST /segments` | `segments.py`（INSERT…ON DUPLICATE KEY UPDATE） | 已实现 |
| `POST /agent/segment/draft`、`POST /agent/segment/confirm` | `agent.py` / `nl_query.py` | 已实现 |
| `POST /dsl/estimate`、`POST /dsl/validate`、`POST /dsl/compile` | `dsl.py` / `engine.py` | 已实现 |
| `POST /objects/search` | `objects.py` | 已实现 |
| `POST /groups`、`GET /groups/{t}`(+`/{id}`、`/code/{code}`、`/{id}/members`) | `groups.py` / `user_groups`、`user_group_members` | 已实现 |
| `POST /groups/{t}/{id}/members`、`DELETE /groups/{t}/{id}/members/{one_id}`、`POST /groups/search` | `groups.py` | 已实现 |
| `GET/POST /engage/journeys`、`GET/PUT/DELETE /engage/journeys/{id}`、`POST .../status` | `journeys`（`engage_api.py` `EngageService`） | 已实现 |
| `GET/PUT /engage/journeys/{id}/steps`、`GET .../state`、`GET .../stats` | `journey_steps`/`journey_state`（`engage_api.py`） | 已实现 |
| `GET/POST /engage/broadcasts`、`GET/PUT/DELETE /engage/broadcasts/{id}` | `broadcasts`（`engage_api.py`） | 已实现 |
| `POST /engage/broadcasts/{id}/send`、`GET .../sends`、`GET .../stats` | `broadcasts`/`broadcast_sends`（`engage_api.py`） | 已实现（send 仅状态置位，模拟） |
| `POST /engage/estimate-audience` | `DslEngine.estimate`（复用底座，dsl 或 segment_code） | 已实现 |
| 受众规模快照写入（趋势） | `audience_size_snapshot`（表已建） | 写入/定时未接 |
| 受众→目的地映射写入 | `segment_destinations`（表已建） | 写入未接 |
| 旅程编排引擎（状态机推进 `journey_state`） | journeys 服务 | 待建 |
| 群发发送引擎（真实外呼 + 生成 `broadcast_sends`） | broadcasts 服务（依赖 Destinations） | 待建 |
| 受众定时增量重算 | 调度 + dsl 重算 | 待建 |

### 3.3 真实 vs Mock 边界

| 维度 | 真实 | Mock |
|------|------|------|
| 数据来源 | MySQL `segments`/`user_groups` + DSL 引擎实时查询；`journeys`/`journey_steps`/`broadcasts` 经 `/engage/*` 真实读写 | `frontend/src/mock/data.ts`（前端仍未接 `/engage`） |
| 受众列表 `/engage` | ✅ 读 `/segments` | — |
| 创建受众 `/engage/audiences/new` | ✅ 全链路（圈人/预估/SQL/存） | — |
| 受众详情 `/engage/audiences/:id` | — | `audienceSample`（规模趋势/连接目的地/规模数）始终是同一条假数据，不读 `:id` |
| 旅程 `/engage/journeys` | 后端 CRUD/步骤/状态/统计已可用（`/api/engage/journeys`） | 前端 `JourneysPage` 仍读 `journeys`（步骤数/在途/转化率） |
| 群发 `/engage/broadcasts` | 后端 CRUD/统计/触达人数预估已可用 | 前端 `BroadcastsPage` 仍读 `broadcasts`（渠道/受众/发送量/打开率） |
| 旅程编排推进 | — | `journey_state` 仅可只读统计，无引擎写入/推进 |
| 群发发送 | `/broadcasts/{id}/send` 仅把状态置 `sending`、记 `sent_at` | 不真正外呼第三方，不生成 `broadcast_sends` 明细 |
| 受众规模趋势 / 受众→目的地 | — | `audience_size_snapshot`/`segment_destinations` 表已建，但无写入流程 |

> 前端 Mock 页面均通过 `components/segment/kit.tsx` 的 `MockTag` 在右上角标注，并复用 `StatCards`/`Sparkline` 套件；接通 `/api/engage/*` 后即可去除对应 `MockTag`。

### 3.4 依赖与集成

- **02-Unify**：共享对象元数据（`/metadata`）、OneID、关系图谱（`meta.relations`），是圈人的数据底座。
- **平台底座 DSL 引擎**：`dsl.py`/`engine.py`/`objects.py` 提供规则→SQL 编译、预估、校验、搜索。
- **自然语言**：`agent.py` + `nl_query.py` 提供 NL→DSL（draft/confirm）。
- **01-Connections（待接）**：Journeys / Broadcasts 的激活需要 Destinations 作为下游发送通道。
- **多租户**：所有端点按 `tenant_id` 隔离，前端顶栏 Workspace 切换驱动。

## 4. TODOs

**已完成（本轮）**

- [x] [数据] 建 `journeys`/`journey_steps`/`journey_state`/`broadcasts`/`broadcast_sends`/`audience_size_snapshot`/`segment_destinations` 表（`sql/migrate_modules.sql`）。
- [x] [后端] 旅程 + 群发全套 CRUD、状态置位、步骤整组替换、运行状态/统计、群发发送状态置位、触达人数预估（`engage_api.py`，前缀 `/engage`）。
- [x] [校验] 全局验收 pytest 411P/0F/2S。

**P0**

- [后端] 受众规模快照写入：定时（按周期）对每个 `segment` 跑 `estimate` 并 `INSERT audience_size_snapshot`；新增 `GET /engage/.../size-trend` 返回最近 N 期序列。
- [前端] `JourneysPage`/`BroadcastsPage` 接通 `/api/engage/*`，去除 `mock/data.ts` 依赖与 `MockTag`。
- [前端] `AudienceDetailPage` 按 `:id` 读真实受众（名称/条件/规模/趋势），去掉 `audienceSample`。
- [后端] 受众详情成员明细：复用 `searchObjects` 或 `groups/{id}/members`，分页返回命中 `one_id`。

**P1**

- [后端] 受众定时增量重算：调度器周期性对 `segments.dsl` 重跑 `estimate`，回写 `estimate` 并落快照。
- [前端][后端] 受众「连接的目的地」接真：写入 `segment_destinations` + 详情页读取。

**P2**

- [后端] 旅程编排引擎：事件驱动状态机，按 `journey_steps`（分流/延时/动作）推进、写入/更新 `journey_state`。
- [后端] 群发发送引擎：对接 01-Connections Destinations，实现 Push/SMS/EDM 真实发送与回执，逐条写 `broadcast_sends`（替换当前 `send` 仅状态置位的模拟）。
- [前端] Journeys / Broadcasts 由 Mock 列表升级为可视化编排器 + 发送配置向导。
- [前端] 受众列表增加规模列、来源（manual/NL）标识与「重算」操作入口。
