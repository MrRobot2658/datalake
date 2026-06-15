# 模块 04 · 客户管理 Accounts

> 状态：**真实** · B2B 账户主数据，一个客户含多个用户 · 账户级聚合 / 父子层级 / 合并日志后端已落地

## 1. 概述

客户管理围绕 **account（客户/账户）** 主数据组织视图：一个客户可关联多个用户（`user --owns--> account`），适用于 B2B / 多用户账户场景。它从统一档案中拆出独立为顶层菜单，对标 Twilio Segment 的 **account-level profiles**——以账户而非个人为单位聚合与圈选。

当前能力为**全真实数据链路**：客户列表、客户详情（含其下用户）均直连 SQL Engine 的 `objects/search`，按 `tenant_id` 隔离。本轮新增独立后端模块 `accounts_api.py`（FastAPI Router，挂载于 `/accounts`），落地了**账户级聚合指标、账户父子层级、账户合并日志**三张真实表与配套读写端点；前端聚合画像 / 按账户圈选 / 层级树展示仍为待建。

## 2. 详细设计（产品）

### 2.1 子功能清单

| 功能 | 英文 | 状态 | 说明 |
|------|------|------|------|
| 客户列表 | Accounts | 真实 | `account` 对象列表，行可点进详情 |
| 客户详情 | Account Detail | 真实 | 客户基本信息 + 该客户下的多个用户（`user --owns--> account`）|
| 账户级聚合/画像 | Account Profile | 半真实 | 用户数 / GMV / 活跃等账户级聚合指标：后端读写端点已建（`account_aggregates`），前端画像页待接 |
| 账户父子层级 | Account Hierarchy | 半真实 | 集团 / 子公司 / 关联方层级：后端读写端点已建（`account_hierarchy`），前端层级树待接 |
| 账户合并日志 | Account Merge Log | 半真实 | 合并 / 去重审计：后端记录与查询端点已建（`account_merge_log`），前端面板待接 |
| 按账户圈选 | Account Audience | 待建 | 以账户为单位圈选受众 |

### 2.2 信息架构与页面

| 路由 | 页面文件 | 说明 | 状态 |
|------|----------|------|------|
| `/accounts` | `pages/AccountsPage.tsx` | 客户列表，`rowLink → /accounts/:id` · **一级菜单** | 真实 |
| `/accounts/:id` | `pages/AccountDetailPage.tsx` | 客户详情 + 该客户下用户 | 真实 |
| `/unify/accounts` | （重定向）| 旧路由 → 重定向到 `/accounts` | 兼容 |
| `/unify/accounts/:id` | `pages/AccountDetailPage.tsx` | 旧路由保留兼容 | 兼容 |

### 2.3 关键用户流程

**客户 → 其下多用户 → 点用户进档案**
进入 `/accounts`（一级菜单「客户管理」）→ `searchObjects(object=account)` 查客户列表 → 点行进 `/accounts/:id` → 详情页两路查询：(a) `account` 基本信息（`account_id eq id`）；(b) 该客户下的用户 = `object=user` + `relation owns account(account_id=:id)` → 用户表 `rowLink → /unify/profiles/:one_id` → 下钻进入用户档案详情。

### 2.4 数据模型

#### 复用既有表

| 对象 / 表 | 类型 | 主键 | 说明 | 状态 |
|-----------|------|------|------|------|
| `object_account` | 表 | `account_id` | 客户主数据（name/industry/scale）| 已存在 |
| `object_relations` | 表 | — | 关系边，含 `user owns account` | 已存在 |
| `doris_user_wide` | 表 | `one_id` | 用户宽表，详情用户下钻目标 | 已存在 |

**关系矩阵（已实现）**：`user owns account`（客户下用户）、`account purchased product`（可扩展账户购买视图）。

#### 本模块新建表（`sql/migrate_modules.sql`，已建）

> 三张表均 `ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`，全部以 `tenant_id` 作为复合主键首列实现租户隔离。

**`account_aggregates` — 账户级聚合指标**（主键 `(tenant_id, account_id)`）

| 列 | 类型 | 约束 / 默认 | 说明 |
|----|------|------------|------|
| `tenant_id` | BIGINT | NOT NULL，PK | 租户 |
| `account_id` | VARCHAR(64) | NOT NULL，PK | 账户 |
| `user_count` | INT | DEFAULT 0 | 账户下用户数 |
| `active_user_count` | INT | DEFAULT 0 | 活跃用户数 |
| `total_gmv` | DECIMAL(12,2) | DEFAULT 0 | 账户累计 GMV |
| `purchase_count` | INT | DEFAULT 0 | 购买次数 |
| `product_count` | INT | DEFAULT 0 | 购买商品数 |
| `channel_count` | INT | DEFAULT 0 | 触达渠道数 |
| `tags` | JSON | — | 账户标签数组 |
| `properties` | JSON | — | 扩展属性 |
| `last_update_time` | DATETIME | — | 写入即 `NOW()` |
| `metric_date` | DATE | — | 指标日期 |
| 索引 | `idx_date (tenant_id, metric_date)` | | 按日期检索 |

**`account_hierarchy` — 账户父子层级**（主键 `(tenant_id, account_id)`）

| 列 | 类型 | 约束 / 默认 | 说明 |
|----|------|------------|------|
| `tenant_id` | BIGINT | NOT NULL，PK | 租户 |
| `account_id` | VARCHAR(64) | NOT NULL，PK | 节点账户 |
| `parent_account_id` | VARCHAR(64) | 可空 | 父账户（顶层为空）|
| `level` | INT | DEFAULT 1 | 层级深度 |
| `path` | VARCHAR(512) | — | 层级路径，如 `A3001/A3002/A3003` |
| `relationship_type` | VARCHAR(32) | — | `group` / `subsidiary` / `affiliate` |
| `properties` | JSON | — | 扩展属性 |
| `create_time` | DATETIME | DEFAULT CURRENT_TIMESTAMP | 创建时间 |
| `update_time` | DATETIME | DEFAULT/ON UPDATE CURRENT_TIMESTAMP | 更新时间 |
| 索引 | `idx_parent (tenant_id, parent_account_id)`、`idx_level (tenant_id, level)` | | 查子节点 / 按层级 |

**`account_merge_log` — 账户合并日志**（主键 `(tenant_id, master_account_id, merged_account_id)`）

| 列 | 类型 | 约束 / 默认 | 说明 |
|----|------|------------|------|
| `tenant_id` | BIGINT | NOT NULL，PK | 租户 |
| `master_account_id` | VARCHAR(64) | NOT NULL，PK | 合并后目标账户 |
| `merged_account_id` | VARCHAR(64) | NOT NULL，PK | 被合并源账户 |
| `action` | VARCHAR(32) | — | `merge` / `dedup` / `unmerge` |
| `merged_fields` | JSON | — | 被合并字段 |
| `user_count` | INT | — | 涉及用户数 |
| `created_at` | DATETIME | DEFAULT CURRENT_TIMESTAMP | 记录时间 |
| `created_by` | VARCHAR(64) | — | 操作人 |
| 索引 | `idx_created (tenant_id, created_at)` | | 按时间倒序查 |

## 2.5 逻辑设计（后端 accounts_api.py）

本模块以独立 Router（`prefix=/accounts`）挂载，不改动 `main.py` 既有内联端点，仅在 `main.py` 中 `include_router(accounts_router)`。`AccountService` 仿 `groups.py` / `tags.py` 风格，**复用同一个 `MysqlOlapExecutor` 配置**；账户列表 / 详情 / 下属用户走 `ObjectService`（对象注册表字段白名单 + 参数化 `build_sql`），聚合 / 层级 / 合并日志走三张新建表的参数化 SQL。**全程不手拼业务 SQL、不让 LLM 产 SQL、所有查询带 `tenant_id`。**

### 端点列表

| Method | Path | 请求 | 响应 | 说明 |
|--------|------|------|------|------|
| GET | `/accounts` | `?tenant_id&limit(1..1000,默认50)` | `{data, ...}`（对象搜索结果） | 账户列表，复用对象筛选路径 |
| POST | `/accounts/search` | body: `[{field, op=eq, value}]`，`?tenant_id&limit` | 同上 | 按条件筛选；条件经对象注册表字段/操作符白名单校验后参数化编译 |
| GET | `/accounts/{account_id}` | `?tenant_id` | `{account, aggregates, hierarchy}` | 账户详情聚合视图；不存在返回 404 |
| GET | `/accounts/{account_id}/users` | `?tenant_id&limit(默认200)` | 对象搜索结果 | 账户下用户 `user --owns--> account`，走对象关系 JOIN（≤3 跳校验）|
| GET | `/accounts/{account_id}/aggregates` | `?tenant_id` | 聚合行或 `{}` | 读 `account_aggregates` |
| PUT | `/accounts/{account_id}/aggregates` | body `AggregateUpsert` | 写入后的聚合行 | upsert `account_aggregates`（`ON DUPLICATE KEY UPDATE`，`last_update_time=NOW()`）|
| GET | `/accounts/{account_id}/hierarchy` | `?tenant_id` | `{node, children[]}` | 读本节点 + 直接子节点（`parent_account_id` 命中）|
| PUT | `/accounts/{account_id}/hierarchy` | body `HierarchyUpsert` | 写入后的节点 | upsert `account_hierarchy` |
| GET | `/accounts/{account_id}/merge-log` | `?tenant_id&limit(1..500)` | 日志数组 | 该账户相关日志（`master` 或 `merged` 命中），按 `created_at` 倒序 |
| GET | `/accounts/-/merge-log` | `?tenant_id&limit` | 日志数组 | 租户全量合并日志（`-` 占位区分单账户路由）|
| POST | `/accounts/merge` | body `MergeRequest` | 写入后的日志行 | 记录账户合并；master==merged 报 400 |

**请求模型（本文件内定义，不动 `schemas.py`）**：`AggregateUpsert`（user_count / active_user_count / total_gmv / purchase_count / product_count / channel_count / tags[] / properties{} / metric_date）；`HierarchyUpsert`（parent_account_id / level / path / relationship_type / properties{}）；`MergeRequest`（master_account_id / merged_account_id / action / merged_fields{} / user_count / created_by）。

### 核心算法 / 流程

- **账户下用户（owns 关系）**：`ObjectService.search(object=user, relations=[{rel_type:owns, object:account, direction:forward, conditions:[account_id eq id]}])`，由对象层做关系白名单与最多 3 跳校验后参数化 JOIN，不在本模块拼 SQL。
- **聚合 / 层级 upsert**：以 `(tenant_id, account_id)` 复合主键做 `INSERT ... ON DUPLICATE KEY UPDATE`，写后回查返回最新行；JSON 列以 `json.dumps(..., ensure_ascii=False)` 写入、`_normalize` 回读时 `json.loads` 还原为对象。
- **合并日志**：以 `(tenant_id, master_account_id, merged_account_id)` 为主键幂等记录；查询既支持单账户（OR 命中 master/merged）也支持租户全量；`limit` 钳制到 1..500。
- **详情聚合视图**：`GET /accounts/{id}` 一次性组合对象主数据 + 聚合 + 层级三路读取，账户不存在直接 404。

### 与其他模块依赖

- 复用 **[03-objects](./03-objects.md)** 的 `ObjectService` / 对象注册表 / 关系矩阵（`user owns account`、`account purchased product`）。
- 复用 **[00-platform](./00-platform.md)** 的 `MysqlOlapExecutor`（OLAP 执行器、连接配置）。
- 下钻 **[02-unify](./02-unify.md)** 的用户档案详情（`/unify/profiles/:one_id`）。

## 3. 技术设计

### 3.1 前端

| 关注点 | 实现 |
|--------|------|
| 客户列表 | `AccountsPage`：`DataTable` + `rowLink={(r) => /accounts/${r._id}}`，数据来自 `searchObjects(object=account)` |
| 客户详情 | `AccountDetailPage`：`StatCards` + 两路 `searchObjects`（账户信息 + 该客户下用户表）；用户表 `rowLink → /unify/profiles/:one_id` |
| 状态 | `useState` 局部态 + `useTenant()` 注入 `tenant`；`useEffect([id, tenant])` 触发查询 |
| API 函数 | `api/client.ts`：`searchObjects(SearchBody) → SearchResult.data` |

### 3.2 后端

| 端点 | 服务 / 文件 | 表 | 状态 |
|------|-------------|----|------|
| `POST /objects/search` | sql-engine `objects.py` | `object_account` + `object_relations` | 已实现（支持 `relations owns account` 过滤）|
| `GET/POST /accounts*` | sql-engine `accounts_api.py`（Router）| `object_account` / `object_relations` / `account_aggregates` / `account_hierarchy` / `account_merge_log` | 已实现（11 个端点，全量验收 pytest 411P/0F/2S）|

### 3.3 真实 vs Mock 边界

- **全真实（后端）**：客户列表 / 详情 / 下属用户查询，以及账户聚合 / 层级 / 合并日志的读写端点，均走 `/api/*` → SQL Engine `:8002` → MySQL `:3308`，按 `tenant_id` 隔离；无 Mock 数据。
- **前端尚未对接**：聚合画像页、层级树展示、合并日志面板、按账户圈选等前端页面仍待建——后端能力已就绪，前端 `StatCards` 等暂未接入真实聚合 / 层级端点。

### 3.4 依赖与集成

- 依赖 **平台底座 [00-platform](./00-platform.md)**：`Layout`/`ui`/`kit`、`TenantContext`、`api/client`。
- 下钻 **统一 [02-unify](./02-unify.md)** 的用户档案详情（`/unify/profiles/:one_id`）。
- 关系矩阵 `account purchased product` 可扩展账户购买视图；对象层见 [03-objects](./03-objects.md)。

## 4. TODOs

**P0（账户级聚合）**
- [x] [后端] 账户级聚合指标表与读写端点（`account_aggregates`，GET/PUT `/accounts/{id}/aggregates`）。
- [ ] [后端] 聚合指标自动计算管道：基于 `owns` / `purchased` 关系实时/批量回填，替代当前手动 upsert。
- [ ] [前端] 详情页 `StatCards` 接真实聚合指标。

**P1（画像与圈选）**
- [ ] [前端] 账户画像页：账户级特征展示。
- [ ] [前端] 按账户圈选受众（account-level audience）。
- [x] [数据] 账户父子层级（集团/子公司）建模（`account_hierarchy`，GET/PUT `/accounts/{id}/hierarchy`）。
- [ ] [前端] 账户层级树展示与编辑。

**P2（治理）**
- [x] [后端] 账户合并日志记录与查询（`account_merge_log`，POST `/accounts/merge`、GET `/accounts/{id}/merge-log`、GET `/accounts/-/merge-log`）。
- [ ] [后端] 合并的真实主数据迁移/去重执行（当前仅审计记录，未真正搬移用户/属性）。
- [ ] [前端] 账户合并日志面板与 CRUD / 字段配置。
