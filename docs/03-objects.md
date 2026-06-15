# 模块 03 · 对象管理 Objects

> 状态：**真实** · 主数据浏览与筛选 + 对象/字段/关系元数据 CRUD（建模自助化已落地）

## 1. 概述

对象管理是 CDP 的「业务主数据视角」：把门店 / 产品 / 订单等核心业务对象作为一等公民浏览，并支持跨对象的关系筛选（如订单 `contains` 产品、用户 `placed` 订单）。它从「以用户为中心」的统一档案中拆出，独立成为顶层菜单，对标 Twilio Segment 的 **Linked Objects** 视角——围绕业务实体而非仅围绕 Profile 来组织数据。

当前能力为**全真实数据链路**：对象 Hub、各对象列表、跨对象关系筛选均直连 SQL Engine 的 `objects/search`，按 `tenant_id` 隔离。本轮进一步落地**对象建模自助化**（元数据驱动）：新增 `objects_api.py` 路由，提供对象/字段/关系的元数据 CRUD、单对象详情与一跳关联查询；自建对象/字段/关系写入 `object_definitions` / `object_fields` / `relation_definitions` / `relation_properties`，运行期与内置 `OBJECT_REGISTRY` / `RELATION_MATRIX` 合并。前端对象详情页仍为待建。

## 2. 详细设计（产品）

### 2.1 子功能清单

| 功能 | 英文 | 状态 | 说明 |
|------|------|------|------|
| 对象 Hub | Objects Hub | 真实 | 门店 / 产品 / 订单卡片，作为一级菜单入口；二级 = 门店/产品/订单 |
| 对象列表 | Object List | 真实 | 任意主对象 + `UnifiedFilter` 全部能力（基对象条件 + 跨对象关系 + 边条件）|
| 跨对象关系筛选 | Linked Objects | 真实 | `objects/search` 支持 relations 链式多跳（≤3 跳）+ edge_conditions |
| 对象详情 | Object Detail | 后端真实/前端待建 | 单对象详情 + 一跳关联已有后端端点（`GET /objects/{tenant_id}/{object_key}/{pk_value}` 及 `/relations`）；前端页面待建 |
| 新建对象 | Create Object | 后端真实/前端待建 | 元数据驱动新建对象 + 物理表，免改代码（`POST /objects/create`，见 §2.5 / 逻辑设计）|
| 字段管理 | Field Management | 后端真实/前端待建 | 增加字段（受控 `ALTER TABLE ADD COLUMN`）+ 编辑/软删元数据（字段白名单，禁物理改类型，见 §2.5 / 逻辑设计）|
| 关系建模 | Relation Modeling | 后端真实/前端待建 | 声明/删除 `src-rel-dst` + 边属性 schema，DB 关系定义与代码矩阵合并（见 §2.5 / 逻辑设计）|

### 2.2 信息架构与页面

| 路由 | 页面文件 | 说明 | 状态 |
|------|----------|------|------|
| `/objects` | `pages/ObjectsHubPage.tsx` | 对象管理 Hub（门店/产品/订单卡片）· **一级菜单**，二级 = 门店/产品/订单 | 真实 |
| `/objects/:key` | `pages/ObjectListPage.tsx` | 对象列表（锁定基对象的 `UnifiedFilter`）| 真实 |
| `/objects/new` | （规划）| 新建对象向导 | 规划 |
| `/objects/:key/schema` | （规划）| 字段管理（增/改字段）| 规划 |
| `/objects/relations` | （规划）| 关系建模（关系矩阵 / 关系图）| 规划 |
| `/unify/objects` | （重定向）| 旧路由 → 重定向到 `/objects` | 兼容 |
| `/unify/objects/:key` | `pages/ObjectListPage.tsx` | 旧路由保留兼容 | 兼容 |

> `ObjectListPage` 按 `:key` 分发：`kind=tag` → `TagsPage`，`kind=segment` → `SegmentsPage`，否则渲染锁定基对象的 `UnifiedFilter`。

### 2.3 关键用户流程

**对象浏览 → 跨对象筛选**
进入 `/objects` Hub（一级菜单「对象管理」）→ 点门店 / 产品 / 订单卡片 → `/objects/:key` → `UnifiedFilter` 锁基对象，支持：基对象条件（字段白名单 + 操作符）、跨对象关系（如订单 `contains` 产品、用户 `placed` 订单）、关系边条件（`create_time` / `properties.*`），编译为 SQL 经 `POST /objects/search` 执行并渲染结果表。

### 2.4 数据模型

| 对象 / 表 | 类型 | 主键 | 说明 | 状态 |
|-----------|------|------|------|------|
| `object_store` | 表 | `store_id` | 门店（store_name/region/address）| 已存在 |
| `object_product` | 表 | `product_id` | 产品（sku/category/price）| 已存在 |
| `object_order` | 表 | `order_id` | 订单（order_no/amount/channel/status）| 已存在 |
| `object_account` | 表 | `account_id` | 客户主数据（详见 [04-accounts](./04-accounts.md)）| 已存在 |
| `object_lead` | 表 | `lead_id` | 线索（lead_name/city/company_size/source/stage）| 已存在 |
| `object_relations` | 表 | — | 关系边：`src_type/rel_type/dst_type/src_id/dst_id/properties/create_time` | 已存在 |

**关系矩阵（来自 metadata，已实现）**：`lead belongs_to user`、`user owns account`、`account purchased product`、`user visited store`、`user placed order`、`order contains product`。边字段统一含 `create_time`，外加各关系声明的 `properties.*`。

#### 2.4.1 元数据驱动建模表（本轮新建，**已建** — 见 `sql/migrate_modules.sql` 03 段）

四张元数据表已写入 `sql/migrate_modules.sql`（`CREATE TABLE IF NOT EXISTS`，`ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`），均含 `tenant_id` 并以其为主键/索引前缀，承载自建对象/字段/关系定义，运行期与代码内置常量合并。

**`object_definitions`** — 对象注册表（内置 + 用户自建）

| 列 | 类型 | 说明 |
|----|------|------|
| `tenant_id` | BIGINT NOT NULL | 租户 |
| `object_key` | VARCHAR(64) NOT NULL | 对象 key，如 `coupon` |
| `label` | VARCHAR(128) | 显示名 |
| `table_name` | VARCHAR(64) | 物理表名 |
| `pk` | VARCHAR(64) | 主键字段名 |
| `icon` | VARCHAR(32) | lucide 图标名 |
| `is_builtin` | TINYINT DEFAULT 0 | 1=内置(禁删/禁改 PK)，0=自建 |
| `sort_order` | INT DEFAULT 0 | 排序 |
| `created_at` / `updated_at` | DATETIME | 审计列 |

主键 `(tenant_id, object_key)`；索引 `idx_builtin(tenant_id, is_builtin)`。

**`object_fields`** — 对象字段定义

| 列 | 类型 | 说明 |
|----|------|------|
| `tenant_id` | BIGINT NOT NULL | 租户 |
| `object_key` | VARCHAR(64) NOT NULL | 所属对象 |
| `field_code` | VARCHAR(64) NOT NULL | 字段标识符，如 `sku` |
| `field_type` | ENUM('int','float','str','json','json_array','datetime') DEFAULT 'str' | 逻辑类型 |
| `is_required` | TINYINT DEFAULT 0 | 是否必填 |
| `default_value` | VARCHAR(256) | 默认值 |
| `field_label` | VARCHAR(128) | 显示名 |
| `is_active` | TINYINT DEFAULT 1 | 软删除以保证向后兼容 |
| `sort_order` | INT DEFAULT 0 | 排序 |
| `created_at` / `updated_at` | DATETIME | 审计列 |

主键 `(tenant_id, object_key, field_code)`；索引 `idx_active(tenant_id, object_key, is_active)`。

**`relation_definitions`** — 关系矩阵（声明式）

| 列 | 类型 | 说明 |
|----|------|------|
| `tenant_id` | BIGINT NOT NULL | 租户 |
| `src_type` | VARCHAR(64) NOT NULL | 源对象 |
| `rel_type` | VARCHAR(64) NOT NULL | 关系动词，如 `contains`/`belongs_to` |
| `dst_type` | VARCHAR(64) NOT NULL | 目标对象 |
| `relation_label` | VARCHAR(256) | 显示名，如「订单包含商品」 |
| `is_builtin` | TINYINT DEFAULT 1 | 内置禁删 |
| `created_at` | DATETIME | 审计列 |

主键 `(tenant_id, src_type, rel_type, dst_type)`；索引 `idx_src(tenant_id, src_type)`、`idx_dst(tenant_id, dst_type)`。

**`relation_properties`** — 关系边属性 schema

| 列 | 类型 | 说明 |
|----|------|------|
| `tenant_id` | BIGINT NOT NULL | 租户 |
| `src_type` / `rel_type` / `dst_type` | VARCHAR(64) NOT NULL | 所属关系三元组 |
| `prop_key` | VARCHAR(64) NOT NULL | 边属性 key，如 `quantity` |
| `prop_type` | ENUM('int','float','str','json','datetime') DEFAULT 'str' | 类型 |
| `prop_label` | VARCHAR(256) | 显示名，如「购买数量」 |
| `sort_order` | INT DEFAULT 0 | 排序 |

主键 `(tenant_id, src_type, rel_type, dst_type, prop_key)`；索引 `idx_relation(tenant_id, src_type, rel_type, dst_type)`。

> 关系实例边仍落既有 `object_relations` 表不变；以上四表只承载「模型(schema)」定义。物理对象表（`object_<key>`）由 `POST /objects/create` 经标识符白名单动态建表，列含 `tenant_id` + 主键 VARCHAR(64) + 各字段 + `created_at`/`updated_at`，主键 `(tenant_id, <pk>)`。

### 2.5 对象建模方案：新建对象 / 字段管理 / 关系建模

> 目标：把当前**写死在代码**的对象模型（`objects.py` 的 `OBJECT_REGISTRY` / `RELATION_MATRIX` / `RELATION_PROPERTIES`）升级为**元数据驱动 + 可视化管理**，让业务自助新建对象、增删改字段、声明对象间关系，无需改 Python。
>
> **进展（本轮）**：后端元数据 CRUD 已落地（`services/sql-engine/objects_api.py`，注册为独立 `APIRouter`，前缀 `/objects`），四张元数据表已建（§2.4.1）。详细端点契约、算法与安全约束见下文「逻辑设计」。本节为产品视角设计说明，仍待补的是**前端可视化页面**（新建向导 / 字段管理 / 关系图）。

#### 2.5.1 现状与差距

- `OBJECT_REGISTRY`（表/主键/字段类型）、`RELATION_MATRIX`（合法 `src-rel-dst`）、`RELATION_PROPERTIES`（边属性）均为 `objects.py` 内的常量；新建对象 / 加字段 = 改代码 + 写 `sql/migrate_*.sql`。
- **数据写入已具备**：`upsert_object`（字段白名单 upsert）、`add_relation`（按矩阵校验后写 `object_relations`）。缺的是**模型(schema)的自助管理**。

#### 2.5.2 新建对象 Create Object

表单：对象 key（如 `coupon`）、显示名、主键字段名、图标。提交后后端：
1. 校验 key 唯一且为合法标识符（`^[a-z][a-z0-9_]*$`，防注入）。
2. 经迁移建物理表 `object_<key>`（主键 + `tenant_id` + 审计列），强制 `utf8mb4`。
3. 写元数据表 `object_definitions`（见 §2.5.5）。
4. 注册表运行时从 DB 加载（`OBJECT_REGISTRY` 改为「内置常量 + DB 合并」），DSL 校验、ETL、前端 `lib/objects` 自动可见。

#### 2.5.3 字段管理 Add / Edit Field

- **增加字段**：code（标识符白名单）、类型（`int/float/str/json/json_array/datetime` 枚举）、必填、默认值、显示名 → `ALTER TABLE object_<key> ADD COLUMN ...` + 写 `object_fields`。
- **编辑字段**：改显示名/必填/默认 安全；**改类型 / 删除**需兼容检查——仅允许安全拓宽（如 `int→str`），删除走软删 `is_active=0`，避免破坏既有数据与查询。
- 字段进入白名单后才能被 `conditions` / `upsert` / ETL 映射使用（沿用「字段不在白名单即拒绝」）。

#### 2.5.4 关系建模 Object ↔ Object

- **声明关系**：选 src 对象、rel 动词（如 `contains`）、dst 对象，定义边属性 schema（`properties.<key>` 类型 + 显示名）→ 写 `relation_definitions` + `relation_properties`（替代代码里的 `RELATION_MATRIX` / `RELATION_PROPERTIES`）。
- **数据边不变**：实例关系仍落 `object_relations`；`add_relation` 改为按 DB 关系定义校验。
- **可视化**：关系矩阵表 / 关系图（节点=对象、边=关系），供筛选器跨对象多跳（≤3 跳）引用。

#### 2.5.5 数据模型（已建）

四张元数据表已落地，真实 DDL（列/类型/键/索引）见 §2.4.1。表名与字段在实现中略有定稿：字段表列名为 `field_code` / `field_type` / `is_required` / `default_value` / `field_label`；关系表 `relation_label`；边属性 `prop_key` / `prop_type` / `prop_label`。

| 表 | 主键 | 状态 |
|---|---|---|
| `object_definitions` | (tenant_id, object_key) | 已建 |
| `object_fields` | (tenant_id, object_key, field_code) | 已建 |
| `relation_definitions` | (tenant_id, src_type, rel_type, dst_type) | 已建 |
| `relation_properties` | (tenant_id, src_type, rel_type, dst_type, prop_key) | 已建 |

#### 2.5.6 安全与约束

- 所有 DDL 经 `scripts/apply_migrations.sh`（utf8mb4）；表/列名走标识符白名单正则，**绝不把用户输入拼进 DDL/DML**（沿用 [00-platform](./00-platform.md) 与 `dsl.py` 安全边界）。
- 多租户：元数据表含 `tenant_id`；物理对象表沿用现有「单库 + `tenant_id` 列」隔离约定。
- 内置对象（user/lead/account/product/store/order）标 `is_builtin`，禁止删除或改主键。

## 2.6 逻辑设计（本轮落地 · `objects_api.py`）

本轮在 sql-engine 新增独立路由 `services/sql-engine/objects_api.py`（`APIRouter(prefix="/objects")`，在 `main.py` 末尾 `app.include_router(objects_admin_router)`）。它**只做加法**：不改 `main.py` / `schemas.py` / `objects.py`，复用 `ObjectService` 与 `OBJECT_REGISTRY` / `RELATION_MATRIX`，自带 Pydantic 模型，业务封装在 `ObjectAdminService`。

### 2.6.1 端点列表

| Method | Path | 请求体/参数 | 响应（要点） |
|--------|------|------------|------------|
| GET | `/objects/{tenant_id}/definitions` | path: tenant_id | `{tenant_id, definitions:[{object_key,label,table_name,pk,icon,is_builtin,fields:[{code,type,required,default,label}]}]}`（仅自建对象，供与内置 `OBJECT_REGISTRY` 合并）|
| POST | `/objects/create` | `{tenant_id, object_key, label?, table_name?, pk_field='id', icon?, initial_fields:[{code,type,required,default,label}]}` | `{ok, object_key, table_name, message}` |
| POST | `/objects/{tenant_id}/relations` | `{src_type, rel_type, dst_type, relation_label?, edge_properties:[{prop_key,prop_type,prop_label?}]}` | `{ok, src_type, rel_type, dst_type}` |
| DELETE | `/objects/{tenant_id}/relations/{src_type}/{rel_type}/{dst_type}` | path 参数 | `{ok}`（内置关系禁删）|
| POST | `/objects/{tenant_id}/{object_key}/fields` | `{field_code, field_type='str', is_required=false, default_value?, field_label?}` | `{ok, field_code, message}` |
| PATCH | `/objects/{tenant_id}/{object_key}/fields/{field_code}` | `{field_label?, is_required?, default_value?, is_active?, field_type?}` | `{ok, field_code}` |
| GET | `/objects/{tenant_id}/{object_key}/{pk_value}/relations` | path 参数 | `{tenant_id, object_key, id, relations:{rel_type:[{object_key,id,direction,properties,create_time,record}]}}` |
| GET | `/objects/{tenant_id}/{object_key}/{pk_value}` | path 参数 | 单对象记录（`SELECT *`，`tags`/`properties` 反序列化）；未找到 404 |

> 路由顺序上 `/{object_key}/{pk_value}/relations` 先于 `/{object_key}/{pk_value}`，避免详情路径吞掉关联路径。

### 2.6.2 核心算法 / 流程

- **对象解析合并 `_resolve_object`**：先查内置 `OBJECT_REGISTRY`（命中即返回 table/pk/字段类型），未命中再查 `object_definitions` + `object_fields(is_active=1)`。`list_definitions` 只列自建对象供前端与内置常量在运行期合并。
- **新建对象 `create_object`**：① 标识符白名单校验 `object_key` / `table_name`（默认 `object_<key>`）/ `pk_field`；② 拒绝占用内置对象与 `_RESERVED_TABLES` 系统表；③ 校验 initial_fields 类型在枚举内、无重名；④ 动态拼 `CREATE TABLE IF NOT EXISTS`（列名经白名单，逻辑类型→物理类型映射 `_SQL_TYPE`，主键 `(tenant_id, <pk>)`，utf8mb4）；⑤ 同事务写 `object_definitions` + 逐字段写 `object_fields`。
- **加字段 `add_field`**：仅对自建对象生效；类型白名单 + 重名/主键冲突检查后执行 `ALTER TABLE ... ADD COLUMN`（**纯加法，类型只扩不窄**），再写 `object_fields`。
- **改字段 `patch_field`**：只改元数据（`field_label`/`is_required`/`default_value`/`is_active` 软删）。若请求带 `field_type` 且与现值不同 → **拒绝**（禁物理改类型，防数据收窄/丢失，引导改为新增字段）。
- **声明关系 `create_relation`**：src/dst 必须是已知对象（内置∪自建）；命中内置 `RELATION_MATRIX` 则拒绝（已存在）；边属性类型白名单；同事务写 `relation_definitions(is_builtin=0)` + 逐条写 `relation_properties`。
- **删除关系 `delete_relation`**：内置（`RELATION_MATRIX` 或 `is_builtin=1`）禁删；先删 `relation_properties` 再删 `relation_definitions`。
- **一跳关联 `get_relations`**：在 `object_relations` 上分别取正向（本对象=src）与反向（本对象=dst）边，按 `rel_type` 分组，对每条边的另一端调用 `get_detail` 回填关联记录，标 `direction=forward/reverse`，`properties` JSON 反序列化。
- **安全边界**：所有数据查询参数化（`%s`）；DDL 无法参数化，故对所有标识符（object_key/table_name/pk/field_code/rel 三元组/prop_key）走 `_IDENT_RE = ^[a-z][a-z0-9_]{0,62}$` 白名单，**绝不把用户输入拼进 DDL/DML 值位**。所有操作带 `tenant_id` 隔离。`ObjectAdminError` 经 `_wrap` 统一转 HTTP 400。

### 2.6.3 与其他模块依赖

- 复用 `objects.py` 的 `OBJECT_REGISTRY` / `RELATION_MATRIX` / `ObjectService` 与 `executor.MysqlOlapExecutor`（共享 OLAP 连接配置，存储仍可经 `OLAP_BACKEND` 切换）。
- 关系实例边沿用既有 `object_relations` 表，与 **02-unify** 用户档案、ETL 导入（**01-connections**）写入的对象数据互通。
- 自建对象/字段一旦进入定义（白名单），即可被 `POST /objects/search` 的 conditions / relations 与 `POST /objects/upsert` 引用（沿用「字段不在白名单即拒绝」）。

## 3. 技术设计

### 3.1 前端

| 关注点 | 实现 |
|--------|------|
| Hub 卡片 | `ObjectsHubPage`：`components/segment/kit` 的 `Catalog`，对象元数据来自 `lib/objects`（`OBJECTS` / `byKey`）|
| 对象列表 | `ObjectListPage`：按 `:key` 分发——`tag` → `TagsPage`、`segment` → `SegmentsPage`，否则渲染锁定基对象的 `UnifiedFilter` |
| 检索器 | `components/filter/UnifiedFilter`：`baseObject` 锁基对象、`lockBase`、`autoSearch`、`rowLink` 透传给结果表 |
| 结果表 | `components/ui` 的 `DataTable`：`rowLink(row) => string?` 使整行可点击跳转 |
| API 函数 | `api/client.ts`：`searchObjects(SearchBody) → SearchResult.data`、`getMetadata` |

### 3.2 后端

| 端点 | 服务 / 文件 | 表 | 状态 |
|------|-------------|----|------|
| `POST /objects/search` | sql-engine `objects.py` | 各 object 表 + `object_relations` | 已实现（conditions + relations 链式多跳 + edge_conditions，≤3 跳）|
| `GET /objects/meta` | sql-engine `objects.py` | — | 已实现（对象注册表）|
| `GET /metadata/{tenant_id}/fields` | sql-engine | `tag_definitions` 等 | 已实现 |
| `POST /objects/upsert` | sql-engine `objects.py` | object 表 | 已实现（字段白名单 + ON DUPLICATE KEY）|
| `GET /objects/{tenant_id}/definitions` | sql-engine `objects_api.py` | `object_definitions` / `object_fields` | 已实现（自建对象定义，供 OBJECT_REGISTRY 合并）|
| `POST /objects/create` | sql-engine `objects_api.py` | `object_definitions` / `object_fields` + 动态 `object_<key>` | 已实现（标识符白名单 → CREATE TABLE）|
| `POST /objects/{tenant_id}/{object_key}/fields` | sql-engine `objects_api.py` | `object_fields` + `ALTER TABLE` | 已实现（仅自建对象，纯加法 ADD COLUMN）|
| `PATCH /objects/{tenant_id}/{object_key}/fields/{field_code}` | sql-engine `objects_api.py` | `object_fields` | 已实现（改元数据/软删，禁物理改类型）|
| `POST /objects/{tenant_id}/relations` | sql-engine `objects_api.py` | `relation_definitions` / `relation_properties` | 已实现（声明关系 + 边属性）|
| `DELETE /objects/{tenant_id}/relations/{src}/{rel}/{dst}` | sql-engine `objects_api.py` | `relation_definitions` / `relation_properties` | 已实现（内置禁删）|
| `GET /objects/{tenant_id}/{object_key}/{pk_value}` | sql-engine `objects_api.py` | object 表 | 已实现（单对象详情）|
| `GET /objects/{tenant_id}/{object_key}/{pk_value}/relations` | sql-engine `objects_api.py` | `object_relations` + 各 object 表 | 已实现（一跳正/反向关联）|

**核心实现要点（`objects.py`）**：`OBJECT_REGISTRY` 注册各对象的表/主键/字段类型；`RELATION_MATRIX` 约束合法 `(src,rel,dst)`；`_build_relations` 递归展开关系树实现链式多跳，`_count_hops > MAX_HOPS(3)` 拒绝；`_edge_col` 仅允许 `create_time` / `properties.<key>`（白名单防注入）。

### 3.3 真实 vs Mock 边界

- **全真实（数据浏览）**：对象 Hub、对象列表、跨对象关系筛选（含链式多跳与边条件）均走 `/api/*` → SQL Engine `:8002` → MySQL `:3308`，按 `tenant_id` 隔离。
- **全真实（建模元数据，本轮新增）**：对象/字段/关系 CRUD、单对象详情、一跳关联端点已落地（`objects_api.py`），四张元数据表已建（§2.4.1），自建对象/字段/关系运行期与内置常量合并。
- **待建（前端）**：对象详情页、新建对象向导、字段管理、关系建模/关系图等可视化页面尚未接入；后端端点已可直接调用。
- 全局验收：`pytest` 411 passed / 0 failed / 2 skipped。

### 3.4 依赖与集成

- 依赖 **平台底座 [00-platform](./00-platform.md)**：`Layout`/`ui`/`kit`、`TenantContext`、`api/client`。
- 与 **统一 [02-unify](./02-unify.md)**：对象经 `object_relations` 与用户档案关联（如 `user placed order`）。
- 上游 **连接 [01-connections](./01-connections.md)**：ETL 导入即写 `object_*` 对象表与关系。

## 4. TODOs

**P0（对象详情）**
- [x] [后端] 详情查询：单对象 + 一跳关系展开端点（`GET /objects/{tenant_id}/{object_key}/{pk_value}` 及 `/relations`，`objects_api.py`）。
- [ ] [前端] 对象详情页：单对象主数据 + 关联对象面板（订单 → 含商品行 `order contains product`），接 P0 后端端点。

**P1（对象建模：元数据驱动，见 §2.5 / 2.6）**
- [x] [后端] 新增元数据表 `object_definitions` / `object_fields` / `relation_definitions` / `relation_properties` + 迁移（已建，§2.4.1）。
- [x] [后端] 新建对象端点：建 `object_<key>` 物理表（标识符白名单）+ 写定义；字段增（受控 `ALTER TABLE ADD COLUMN`）/ 改（元数据，禁物理改类型，软删 `is_active`）。
- [x] [后端] 关系建模端点：声明/删除/校验 `(src,rel,dst)` + 边属性，DB 定义与内置矩阵合并。
- [ ] [后端] `OBJECT_REGISTRY` / `RELATION_MATRIX` 运行期合并：当前为读取端按需 `_resolve_object` 合并 + `/definitions` 暴露；待统一为应用启动/缓存级注入，让 DSL/ETL/search 全链路自动可见自建对象。
- [ ] [前端] 新建对象向导 `/objects/new`、字段管理 `/objects/:key/schema`、关系建模 `/objects/relations`（矩阵/图）；对象数据 CRUD 复用 `POST /objects/upsert`。
- [ ] [前端] 字段/列配置：可选展示列、排序、筛选保存。

**P2（检索与导出）**
- [ ] [前端] 对象级全文搜索框 + 结果导出（CSV）。
- [ ] [后端] 大结果集分页/排序（limit≤1000）。
