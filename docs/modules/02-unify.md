# 模块 02 · 统一 Unify

> 状态：**核心已接真**（Profiles/身份解析规则/泛对象标签/动态群组/SQL 特征/预测推理/档案回流均已落库），少量前端待接 · 对标 Segment Unify
>
> 本轮（2026-06）落地：新建 `identity_resolution_rules` / `object_tags` / `object_group_members` / `sql_trait_definitions` / `sql_trait_results` / `prediction_models` 六张表并扩展 `tag_definitions.object_type`、`user_groups.member_object_type`；后端新增 `services/sql-engine/unify_api.py`（独立 `APIRouter`，prefix `/unify`）共 18 个端点，覆盖身份解析规则 CRUD、任意对象打标、动态群组刷新、SQL 特征定义/执行落库、预测模型配置/推理、档案回流、叠加标签的泛对象搜索。全局验收 pytest 411 通过 / 0 失败 / 2 跳过。

## 1. 概述

统一 Unify 是 CDP 的「身份与对象中枢」：把来自各渠道的零散行为汇聚到一个 **OneID** 用户档案上，并围绕用户挂载门店 / 产品 / 订单 / 客户（account）/ 线索（lead）等业务对象，通过 `object_relations` 表达它们之间的关联。对标 Twilio Segment 的 Unify（Profiles + Linked Profiles/Objects + Identity Resolution + Computed/SQL Traits + Predictions + Profiles Sync）。

当前能力以**真实数据链路**为主：用户档案检索、用户档案详情、跨对象关系查询、计算特征（复用标签）均直连 SQL Engine + ID-Mapping + MySQL；身份解析规则配置、SQL Traits、Predictions、Profiles Sync 暂为 Mock。对象管理与客户管理已拆为独立顶层模块（见 [03-objects](./03-objects.md) / [04-accounts](./04-accounts.md)）。

## 2. 详细设计（产品）

### 2.1 子功能清单

| 功能 | 英文 | 状态 | 说明 |
|------|------|------|------|
| 用户档案检索 | Profiles Explorer | 真实 | `UnifiedFilter` 锁定 `user` 基对象，按标识符/属性/关系检索 `doris_user_wide`，结果行可点进详情 |
| 用户档案详情 | Profile Detail | 真实 | 按 `one_id` 查宽表，渲染身份标识 / 特征 Traits / 行为时间线（`properties.behaviors`）|
| 跨对象关系查询 | Relations / Linked Objects | 真实 | `objects/search` 支持 relations 链式多跳（≤3 跳）+ edge_conditions |
| 计算特征 | Computed Traits | 真实（只读）| 复用 `TagsPage` 读 `/tags`，展示已落库标签；暂无拖拽构建器 |
| 标签 | Tags | 半真→规划 | 标签树（现 user-only）→ 升级为**任意对象通用打标**（见 §2.5）|
| 群组 | Groups | 半真→规划 | 人群包；动态/静态、成员可为任意对象（见 §2.5）；现 `groups.py` 仅手动成员 |
| 身份解析 | Identity Resolution | Mock | 规则配置（merge 策略/上限/唯一性）为 `mock/data.ts` 的 `identityRules` |
| SQL 特征 | SQL Traits | Mock | `mock/data.ts` 的 `sqlTraits`，未接数仓执行 |
| 预测 | Predictions | Mock | `mock/data.ts` 的 `predictions`，未接模型 |
| 档案回流 | Profiles Sync | Mock | `mock/data.ts` 的 `profilesSync`，未接回流数仓 |

### 2.2 信息架构与页面

| 路由 | 页面文件 | 说明 | 状态 |
|------|----------|------|------|
| `/unify` | `pages/UnifyPage.tsx` | 用户档案检索，`UnifiedFilter` 锁 `user`、`autoSearch`，`rowLink → /unify/profiles/:one_id` | 真实 |
| `/unify/profiles/:id` | `pages/segment/ProfileDetailPage.tsx` | 用户档案详情（按 `one_id` 查宽表）| 真实 |
| `/unify/traits` | `pages/TagsPage.tsx`（经 `ObjectListPage` 复用）| 计算特征 Computed Traits，读 `/tags` | 真实（只读）|
| `/unify/tags` | （规划）| 标签管理（任意对象通用打标）| 规划 |
| `/unify/groups` | （规划）| 群组（动态 / 静态、成员对象类型）| 规划 |
| `/unify/identity` | `pages/segment/*` | 身份解析规则配置 | Mock |
| `/unify/sql-traits` | `pages/segment/*` | SQL 特征 | Mock |
| `/unify/predictions` | `pages/segment/*` | 预测 | Mock |
| `/unify/sync` | `pages/segment/*` | 档案回流 | Mock |

> `ObjectListPage` 按 `:key` 分发：`kind=tag` → `TagsPage`，`kind=segment` → `SegmentsPage`，否则渲染锁定基对象的 `UnifiedFilter`。

### 2.3 关键用户流程

**① 档案检索 → 点行进详情**
进入 `/unify` → `UnifiedFilter`（锁 `user`）自动检索宽表 → 结果表每行透传 `rowLink(r) => /unify/profiles/${r.one_id}` → 点击进入 `ProfileDetailPage`，按 `one_id` 查 `doris_user_wide`，渲染身份标识（one_id/phone/email/wechat_openid/…）、特征（channel_count/total_orders/total_amount/tags…）、行为时间线（`properties.behaviors` 取最近 12 条按时间倒序）。

> 对象列表筛选、客户→用户下钻等流程已迁至独立模块 [03-objects](./03-objects.md) / [04-accounts](./04-accounts.md)。

### 2.4 数据模型

| 对象 / 表 | 类型 | 主键 | 说明 | 状态 |
|-----------|------|------|------|------|
| `doris_user_wide` | 表 | `one_id` | 用户宽表，含 `phone/tags/channel_count/properties(json,含 behaviors)` | 已存在 |
| `object_account` | 表 | `account_id` | 客户主数据（name/industry/scale）| 已存在 |
| `object_order` | 表 | `order_id` | 订单（order_no/amount/channel/status）| 已存在 |
| `object_product` | 表 | `product_id` | 产品（sku/category/price）| 已存在 |
| `object_store` | 表 | `store_id` | 门店（store_name/region/address）| 已存在 |
| `object_lead` | 表 | `lead_id` | 线索（lead_name/city/company_size/source/stage）| 已存在 |
| `object_relations` | 表 | — | 关系边：`src_type/rel_type/dst_type/src_id/dst_id/properties/create_time` | 已存在 |
| `id_mapping` / `doris_id_mapping` | 表 | — | channel → one_id 映射 | 已存在 |
| `merge_log` | 表 | — | OneID 合并日志 | 已存在 |
| `one_id_sequence` | 表 | — | OneID 发号器 | 已存在 |
| `tag_definitions` | 表 | — | 标签/计算特征定义；本轮 `_add_col` 增 `object_type VARCHAR(32) NOT NULL DEFAULT '*'`（适用对象类型，`*`=通用）+ `idx_object_type(tenant_id,object_type)` | 已存在·已扩展 |
| `user_groups` | 表 | — | 群组；本轮 `_add_col` 增 `member_object_type VARCHAR(32) NOT NULL DEFAULT 'user'` + `idx_member_type(tenant_id,member_object_type)` | 已存在·已扩展 |
| `identity_resolution_rules` | 表 | `(tenant_id, rule_id)` | 身份解析规则：`identifier_type / priority(1-100) / max_per_profile / is_unique / is_primary / merge_strategy(take_min/take_max/latest) / enabled`；`UNIQUE(tenant_id,identifier_type)`、`idx_priority(tenant_id,priority)` | **已建** |
| `object_tags` | 表 | `(tenant_id, object_type, object_id, tag_code)` | 任意对象打标：`source(manual/computed/imported) / assigned_by / assigned_at`；`idx_object(tenant_id,object_type,object_id)`、`idx_tag(tenant_id,tag_code)` | **已建** |
| `object_group_members` | 表 | `(tenant_id, group_id, object_type, object_id)` | 泛对象群组成员（不改既有 `user_group_members` PK）：`source(manual/dynamic/imported) / added_at`；`idx_object(tenant_id,object_type,object_id)` | **已建** |
| `sql_trait_definitions` | 表 | `(tenant_id, trait_id)` | SQL 特征定义：`trait_code / trait_name / sql_query(TEXT) / warehouse_type / warehouse_id / schedule_type(manual/hourly/daily) / schedule_cron / result_table / last_run_time / last_row_count / enabled`；`UNIQUE(tenant_id,trait_code)`、`idx_schedule(tenant_id,schedule_type)` | **已建** |
| `sql_trait_results` | 表 | `(tenant_id, trait_id, object_type, object_id)` | SQL 特征结果：`trait_value VARCHAR(512) / computed_at / version`；`idx_trait(tenant_id,trait_id)`、`idx_computed(computed_at)` | **已建** |
| `prediction_models` | 表 | `(tenant_id, model_id)` | 预测模型配置：`model_name / model_type(purchase/churn/ltv) / target_event / features(JSON) / training_data_days / inference_horizon / quality_score DECIMAL(5,2) / last_training_at / last_inference_at / enabled`；`UNIQUE(tenant_id,model_name)` | **已建** |

> 档案回流复用连接模块表 `connections_reverse_etl_jobs` / `connections_reverse_etl_runs`（见 [01-connections](./01-connections.md)），不在本模块重复建表。预测推理结果写入 `doris_user_wide.properties.pred_<model>`（JSON_SET）。本模块所有新表均 `CREATE TABLE IF NOT EXISTS`、`DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`、每张含 `tenant_id`，定义见 `sql/migrate_modules.sql`（02 · unify 段），经 `scripts/apply_migrations.sh` 应用。

**关系矩阵（来自 metadata，已实现）**：`lead belongs_to user`、`user owns account`、`account purchased product`、`user visited store`、`user placed order`、`order contains product`。边字段统一含 `create_time`，外加各关系声明的 `properties.*`（如 `purchased.amount/quantity/channel`、`visited.duration`、`placed.channel`、`contains.quantity`）。

### 2.5 特征 / 标签 / 群组：概念关系与方案

#### 2.5.1 三者关系（核心澄清）

| 概念 | 英文 | 是什么 | 落在哪 | 回答的问题 |
|------|------|--------|--------|-----------|
| 计算特征 | Computed Trait | **怎么算**：按规则/聚合得到的派生指标或标签（total_orders、RFM、近 30 天活跃）| 落宽表 `properties` 或**产出一个标签** | 「这个对象的某指标是多少」|
| 标签 | Tag | **定性结果维度**：可枚举的分类，挂对象实例（用户=高价值、门店=旗舰、产品=爆款）；层级树 | `tag_definitions`(定义) + 对象上的标签值 | 「这个对象属于哪些类」|
| 群组 | Group / 人群包 | **对象的集合**：一批对象实例 | `user_groups` + 成员表 | 「哪些对象在一起」|

一句话：**特征/标签是对象的「维度」（描述单个对象），群组是对象的「集合」（一批对象）。**

- 计算特征 vs 标签：是「**算法**」与「**结果**」的关系，不是并列两类——Trait 的产物之一可以是一个标签（算出来→打标）。
- 群组 vs 特征/标签：动态群组的筛选规则**引用**特征与标签作为条件，即「维度是输入，群组是基于维度的结果集」。
- 与 [05-engage](./05-engage.md) 受众：**受众 Audience = 面向触达/激活的群组**（多为动态群组），与此处「群组」共用同一筛选引擎与成员模型；Unify 侧群组偏「资产沉淀」，Engage 侧偏「激活」。

#### 2.5.2 每个对象都支持标签（现状 → 方案）

- 现状：标签仅作用于**用户**——`tag_definitions` 是标签树，标签值存 `doris_user_wide.tags`，`tags.py` 只在宽表上按标签筛选。
- 方案——把标签从「用户专属」升级为「任意对象通用」：
  1. `tag_definitions` 增 `object_type`（该标签适用对象类型，`*`=通用）。
  2. 新增通用关联表 `object_tags(tenant_id, object_type, object_id, tag_code, source, create_time)`，任意对象实例可打标；用户标签可继续冗余进宽表 `tags` 列以保查询性能。
  3. `objects/search` 的 `conditions` 支持引用「标签」作为条件（对 `object_tags` 半连接）；各对象列表/详情展示标签。
  4. 打标来源 `source`：手动 / 规则（计算特征产出）/ 导入。

#### 2.5.3 群组：动态 vs 静态（现状 → 方案）

- 现状：`user_groups` 已有 `group_type ENUM(static,dynamic)` + `filter_rule JSON`，但 `groups.py` 只支持**手动成员**（`add_member`），动态规则未执行，成员限用户（one_id）。
- 方案：
  - **静态群组**：成员固定名单——手工添加 / CSV 导入 / 某次筛选「存为群组」的快照；存 `group_members`，不随数据变化。
  - **动态群组**：`filter_rule` 保存一条 **DSL 规则**（复用 `objects/search` 的 conditions + relations）；成员 = 规则实时命中集。落地两种：查询期实时计算（小群组）或调度刷新写 `group_members(source=dynamic)`（大群组，配合 [08-monitor](./08-monitor.md) 调度）。数据变化（新事件/新标签）→ 成员自动进出。
  - **成员对象类型**：群组增 `member_object_type`（默认 user），使「门店群组」「产品群组」等成立，对齐「每个对象都可成群」。
  - **联动**：动态群组规则里可直接用「标签=高价值」「特征 total_orders>10」作条件。

#### 2.5.4 IA 落点

在 Unify 增加/明确两个子页（标签=对象维度、群组=对象集合，均贴近档案）：
- **标签 Tags**（`/unify/tags`）：标签树管理 + 按对象类型筛选 + 打标来源；是现 `/unify/traits` 只读视图的升级。
- **群组 Groups**（`/unify/groups`）：群组列表（区分动态/静态、成员对象类型、成员数）+ 新建（静态名单 / 动态规则）+ 与 Engage 受众互通。
> 计算特征（Computed Traits）与标签同处 Unify：Trait 负责「算」，产出落到宽表特征或标签。

#### 2.5.5 数据模型（新增 / 扩展）

| 表 | 变更 | 说明 |
|---|---|---|
| `tag_definitions` | + `object_type` | 标签适用对象类型（`*`=通用）|
| `object_tags`（新） | tenant_id, object_type, object_id, tag_code, source, create_time | 任意对象打标 |
| `user_groups` | + `member_object_type`（默认 user）| 群组成员对象类型 |
| `group_members` | 既有(static) + `source`(manual/dynamic) | 动态群组刷新结果可落此 |

## 3. 技术设计

### 3.1 前端

| 关注点 | 实现 |
|--------|------|
| 检索器 | `components/filter/UnifiedFilter`：`baseObject` 锁基对象、`lockBase`、`autoSearch`、`rowLink` 透传给结果表 |
| 结果表 | `components/ui` 的 `DataTable`：`rowLink(row) => string?` 使整行可点击跳转（返回 `undefined` 则不可点）|
| Hub 卡片 | `components/segment/kit` 的 `Catalog`，对象元数据来自 `lib/objects`（`OBJECTS`/`byKey`）|
| 详情渲染 | `ProfileDetailPage`：身份标识 dl、特征 Traits、`kit.Timeline` 行为时间线；`AccountDetailPage`：`StatCards` + 用户 `DataTable` |
| 状态 | `useState` 局部态 + `useTenant()` 注入 `tenant`；`useEffect([id, tenant])` 触发查询 |
| API 函数 | `api/client.ts`：`searchObjects(SearchBody{tenant_id,object,conditions?,relations?,logic?,limit?,count_only?}) → SearchResult.data`、`getMetadata`、`listTags` |

**行点击链路**：`UnifyPage`/`AccountsPage`/`AccountDetailPage` 把 `rowLink` 函数交给 `DataTable`（或经 `UnifiedFilter` 透传），表格内每行据此渲染为链接。`UnifyPage` 用 `rowLink={(r) => r.one_id != null ? /unify/profiles/${r.one_id} : undefined}`，`AccountDetailPage` 的用户表用 `rowLink={(r) => /unify/profiles/${r._id}}`。

### 3.2 后端

| 端点 | 服务 / 文件 | 表 | 状态 |
|------|-------------|----|------|
| `POST /objects/search` | sql-engine `objects.py` | 各 object 表 + `object_relations` | 已实现（conditions + relations 链式多跳 + edge_conditions，≤3 跳）|
| `POST /objects/relations` | sql-engine `objects.py` | `object_relations` | 已实现（关系矩阵列举/校验）|
| `POST /objects/upsert` | sql-engine `objects.py` | object 表 | 已实现（字段白名单 + ON DUPLICATE KEY）|
| `GET /objects/meta` | sql-engine `objects.py` | — | 已实现（对象注册表）|
| `GET /metadata/{tenant_id}/fields` | sql-engine | `tag_definitions` 等 | 已实现 |
| `GET /tags/{tenant_id}`（+`/tree`、`/code/{code}/count`）| sql-engine `tags.py` | `tag_definitions` | 已实现 |
| `GET /users/{tenant_id}/{one_id}`（+`/groups`）| id-mapping | `doris_user_wide` | 已实现 |
| `GET /profile/{t}/{one_id}`、`/wide/{t}/{one_id}`、`/wide/query/{t}` | id-mapping | `doris_user_wide` | 已实现 |
| `GET /mapping/{t}/{channel_type}/{channel_id}` | id-mapping | `id_mapping` | 已实现 |
| `GET /merge-log/{t}` | id-mapping | `merge_log` | 已实现 |
| `POST /events/process`、`POST /users/import` | id-mapping | 宽表 + 映射 | 已实现 |
| `GET/POST/DELETE /unify/identity-rules/{tenant_id}[/{rule_id}]` | sql-engine `unify_api.py` | `identity_resolution_rules` | **已实现**（列表/upsert/删除）|
| `POST /unify/tags/{tenant_id}/{code}/assign`、`DELETE …/object/{type}/{id}`、`GET /unify/object-tags/{tenant_id}/{type}/{id}` | sql-engine `unify_api.py` | `object_tags` | **已实现**（任意对象打标/去标/查标）|
| `GET /unify/groups/{tenant_id}`、`POST /unify/groups/{tenant_id}/{group_id}/refresh` | sql-engine `unify_api.py` | `user_groups` + `object_group_members` | **已实现**（动态群组按 `filter_rule` 刷新成员）|
| `POST/GET /unify/sql-traits/{tenant_id}`、`POST …/{trait_id}/execute`、`POST …/execute` | sql-engine `unify_api.py` | `sql_trait_definitions` / `sql_trait_results` | **已实现**（定义 + 执行落库）|
| `POST/GET /unify/predictions/{tenant_id}`、`POST …/{model_id}/infer` | sql-engine `unify_api.py` | `prediction_models` + `doris_user_wide.properties` | **已实现**（配置 + 模拟推理写宽表）|
| `POST /unify/profiles/sync/{tenant_id}` | sql-engine `unify_api.py` | `connections_reverse_etl_jobs` / `_runs` | **已实现**（注册任务 + 执行一次回流）|
| `POST /unify/objects/search` | sql-engine `unify_api.py` | object 表 + `object_relations` + `object_tags` | **已实现**（在 `ObjectService` 之上叠加标签过滤）|

**核心实现要点（`objects.py`）**：`OBJECT_REGISTRY` 注册各对象的表/主键/字段类型；`RELATION_MATRIX` 约束合法 `(src,rel,dst)`；`build_sql` 把筛选编译为参数化 SQL（不执行，供 S2 DSL 复用），`_build_relations` 递归展开关系树，每跳 target 成为下一跳锚点实现链式多跳，`_count_hops > MAX_HOPS(3)` 拒绝；`_edge_col` 仅允许 `create_time` / `properties.<key>`（白名单防注入）；`user.one_id` 为数值，与 `object_relations.src_id/dst_id`(VARCHAR) 比较时双向 CAST。

### 3.5 逻辑设计（本轮 `/unify` 端点）

实现位于 `services/sql-engine/unify_api.py`：自带 `APIRouter(prefix="/unify")` 与 `UnifyService`、本地 Pydantic 模型，**不改 `main.py` / `schemas.py` / 既有 service**（只 include router）。所有写操作参数化、按 `tenant_id` 隔离；圈人一律复用 `ObjectService.search`（validate→compile），不手拼业务筛选 SQL。统一异常包装 `_wrap`：`ObjectError → 400`、`Duplicate → 409`、其余 `→ 500`。

| Method · Path | 请求体 | 响应 | 说明 |
|---|---|---|---|
| `GET /unify/identity-rules/{tenant_id}` | — | 规则数组（按 priority 升序）| 列出身份解析规则 |
| `POST /unify/identity-rules/{tenant_id}` | `IdentityRuleIn{identifier_type, priority=50, max_per_profile?, is_unique, is_primary, merge_strategy?, description?, enabled}` | 落库后的规则行 | upsert；`rule_id` 缺省取 `rule_<identifier_type>`；`ON DUPLICATE KEY` |
| `DELETE /unify/identity-rules/{tenant_id}/{rule_id}` | — | `{ok:true}` / 404 | 删除规则 |
| `POST /unify/tags/{tenant_id}/{code}/assign` | `TagAssignIn{object_type, object_id, source=manual, assigned_by?}` | `object_tags` 行 | 给任意对象实例打标；`object_type` 必须在 `OBJECT_REGISTRY` |
| `DELETE /unify/tags/{tenant_id}/{code}/object/{object_type}/{object_id}` | — | `{ok:true}` / 404 | 去标 |
| `GET /unify/object-tags/{tenant_id}/{object_type}/{object_id}` | — | `{tags:[...]}` | 查某对象的全部标签 |
| `GET /unify/groups/{tenant_id}?filter_type=static\|dynamic` | — | 群组数组（`filter_rule` 已 JSON 解析）| 列群组，可按 `group_type` 过滤 |
| `POST /unify/groups/{tenant_id}/{group_id}/refresh` | — | `{matched, member_count, object_type, source:dynamic}` | 动态群组刷新（见下算法）|
| `POST /unify/sql-traits/{tenant_id}` | `SqlTraitIn{trait_code, sql_query, warehouse_type=mysql, schedule_type=manual, result_table?, object_type=user, enabled}` | 定义行 | upsert SQL 特征定义 |
| `GET /unify/sql-traits/{tenant_id}` | — | 定义数组（含 `result_count` 子查询计数）| 列特征定义 |
| `POST /unify/sql-traits/{tenant_id}/{trait_id}/execute` | — | `{executed, row_count, elapsed_ms, traits[]}` | 执行单个特征并落库 |
| `POST /unify/sql-traits/{tenant_id}/execute` | `SqlTraitExecuteIn{trait_id?}` | 同上 | `trait_id` 缺省执行该租户全部 `enabled` 特征 |
| `POST /unify/predictions/{tenant_id}` | `PredictionModelIn{model_name, model_type, target_event?, features[], training_data_days?, inference_horizon?, enabled}` | 模型行（`features` 已解析）| upsert 预测模型 |
| `GET /unify/predictions/{tenant_id}` | — | 模型数组 | 列模型 |
| `POST /unify/predictions/{tenant_id}/{model_id}/infer` | — | `{property_key, row_count, quality_score, elapsed_ms}` | 模拟推理写宽表 |
| `POST /unify/profiles/sync/{tenant_id}` | `ProfileSyncIn{target_warehouse, source_object=doris_user_wide, tables[], schedule?}` | `{job_id, run_id, status, row_count}` | 注册回流任务 + 执行一次 |
| `POST /unify/objects/search` | `UnifyObjectSearchIn{tenant_id, object, conditions[], relations[], tag_codes[], tag_logic=or, logic=AND, limit=50, count_only}` | `SearchResult`（命中行回填 `object_tags`）| 泛对象搜索 + 标签过滤 |

**核心算法 / 流程**

- **动态群组刷新 `refresh_group`**：读 `user_groups.filter_rule`（须含 `conditions` 或 `relations`，否则 400）→ 取 `object_type = rule.object || member_object_type || user` 与其主键字段 → 调 `ObjectService.search(limit=100000)` 拿命中主键集 → 事务内先 `DELETE … source='dynamic'` 再 `executemany INSERT … ON DUPLICATE KEY`（仅替换动态成员，保留 manual 成员）→ 回写 `user_groups.member_count`。
- **SQL 特征执行 `execute_sql_traits`**：安全闸 `_assert_readonly`——仅单条语句（拒分号）、必须 `^(select|with)`、必须含 `tenant_id`；以命名参数 `{"tenant_id": …}` 执行（失败回退无参执行）；结果行须含 `object_id` 与 `trait_value`（否则 400），`object_type` 缺省 `user`；`ON DUPLICATE KEY` 落 `sql_trait_results`（`version+1`）并回写定义的 `last_run_time/last_row_count`。
- **预测推理 `infer_prediction`**（dev 模拟，非真实模型）：取目标租户 `doris_user_wide.one_id`，按 `hash((model_id, one_id))` 生成确定性伪分值，`JSON_SET(properties, '$.pred_<safe_model>', score)` 写回宽表；`<safe_model>` 经 `_safe_key` 收敛为 `[0-9A-Za-z_]` 后作为绑定参数路径防注入；回写模型 `quality_score/last_inference_at`。
- **档案回流 `sync_profiles`**：upsert `connections_reverse_etl_jobs` → 统计源对象当前租户行数为 `row_count` → 插一条 `connections_reverse_etl_runs` → 累加 `total_synced_rows`。
- **泛对象搜索 `search_with_tags`**：无 `tag_codes` 时直通 `ObjectService.search`（含 `count_only`）；有标签时先取候选（limit=5000），再用 `_tag_matched_ids`（`object_tags` 按 `tag_logic` and/or 计 `COUNT(DISTINCT tag_code)` 命中阈值）求交集，命中行回填全部标签。

**与其他模块依赖**

- 内部复用 `objects.py` 的 `OBJECT_REGISTRY` / `ObjectError` / `ObjectService`（圈人与对象类型校验）、`executor.py` 的 `MysqlOlapExecutor`（连接配置）。
- 档案回流写入连接模块 [01-connections](./01-connections.md) 的 `connections_reverse_etl_jobs` / `_runs`。
- 标签/群组扩展与 [03-objects](./03-objects.md) 的对象注册表、[05-engage](./05-engage.md) 的受众共用筛选引擎与成员模型。

### 3.3 真实 vs Mock 边界

- **真实**：用户档案检索与详情、对象 Hub/列表、客户列表/详情、跨对象关系查询（含链式多跳与边条件）、计算特征只读展示。全部走 `/api/*` → SQL Engine `:8002` / ID-Mapping `:8001` → MySQL `:3308`，按 `tenant_id` 隔离。
- **本轮转真（后端已落库，前端待接）**：身份解析规则 CRUD、任意对象打标、动态群组刷新、SQL 特征定义/执行落库、预测模型配置/推理、档案回流——后端 `/unify/*` 已实数据链路（真实读写 MySQL），前端 `/unify/identity` `/unify/sql-traits` `/unify/predictions` `/unify/sync` 仍指向 `frontend/src/mock/data.ts`，待切到 `/unify/*` API。
- **仍为模拟**：预测推理为 dev 确定性伪分值（非真实模型训练/评分）；SQL 特征执行在 MySQL 上跑（模拟数仓）；档案回流仅注册任务并以源行数计数（不真正写外部仓）。
- **半真**：计算特征仅「读」`/tags`，缺少 Segment 式拖拽构建器；定时计算依赖调度（[08-monitor](./08-monitor.md)）尚未接入，现为手动 `execute`。

### 3.4 依赖与集成

- 依赖 **平台底座 [00-platform](./00-platform.md)**：`Layout`/`ui`/`kit`、`TenantContext`、`api/client`。
- 上游 **连接 [01-connections](./01-connections.md)**：ETL/事件接入 → `POST /events/process` 写映射、宽表与 `object_relations`。
- 下游 **触达 [05-engage](./05-engage.md)**：`/unify` 检索结果可「基于筛选创建受众」（跳 `/engage/audiences/new`），受众圈人复用 `objects/search` 跨对象能力。
- 内部依赖：`lib/objects`（对象注册）、`object_relations` 关系矩阵、id-mapping 的 OneID 识别/merge。
- 对象/客户已拆为独立模块 [03-objects](./03-objects.md) / [04-accounts](./04-accounts.md)（用户经 `object_relations` 关联，本模块仍复用 `objects/search` 关系能力）。

## 4. TODOs

**P0（把核心 Mock 接真）**
- [x] [后端] 身份解析规则表 + CRUD 端点：merge 策略 / 标识符优先级 / 合并上限 / 唯一性约束（`identity_resolution_rules` + `/unify/identity-rules/*`）。
- [ ] [后端] `POST /events/process` 读取 `identity_resolution_rules` 执行 merge（规则已建，merge 逻辑尚未接读规则）。
- [ ] [前端] `/unify/identity` 接 `/unify/identity-rules/*`，替换 `identityRules`；展示 `merge-log`。
- [ ] [数据] 校验关系矩阵与边字段元数据与实际数据一致（`purchased/visited/placed/contains` 的 `properties.*`）。

**P1（特征 / 标签 / 群组，见 §2.5）**
- [x] [后端] 标签通用化：`tag_definitions` 增 `object_type` + 新增 `object_tags` 关联表；`/unify/objects/search` 支持按标签筛选；任意对象可打标（`/unify/tags/*`）。
- [x] [后端] 群组动态化：`refresh_group` 执行 `filter_rule`（复用 `ObjectService.search`）；`user_groups` 增 `member_object_type`、新增 `object_group_members(source)`；动态群组调度刷新落库。
- [x] [后端] SQL Traits 执行器：`sql_trait_definitions` 跑只读 SQL → 落 `sql_trait_results`；`/unify/sql-traits/*` 已接真（执行在 MySQL 模拟数仓）。
- [ ] [前端] 标签管理页 `/unify/tags`（按对象类型）、群组页 `/unify/groups`（动态/静态、与受众互通）。
- [ ] [前端] Computed Traits 拖拽构建器：基于 `objects/search` 条件 + 聚合，生成 trait 定义（当前仅只读 `/tags`）。
- [ ] [前端] SQL 特征页 `/unify/sql-traits` 接 `/unify/sql-traits/*`，替换 `sqlTraits`。
- [ ] [前端] 用户档案详情补充关联对象（订单/门店/产品）面板，复用关系查询。

**P2（预测与回流）**
- [x] [后端] Predictions 模型配置 + 推理：`prediction_models` + `/unify/predictions/*`，结果写宽表 `properties.pred_*`（dev 模拟评分，待接真实模型）。
- [x] [后端] Profiles Sync：`/unify/profiles/sync/*` 注册 `connections_reverse_etl_jobs` 并执行一次（待接真实外部仓写入）。
- [ ] [后端] 预测接真实模型训练/评分；SQL 特征/特征计算接调度（[08-monitor](./08-monitor.md)）定时执行。
- [ ] [前端] `/unify/predictions`、`/unify/sync` 接 `/unify/*` API，替换 `predictions` / `profilesSync`。
- [ ] [前端] `DataTable` 分页/排序/导出，提升大结果集（limit≤1000）浏览体验。
