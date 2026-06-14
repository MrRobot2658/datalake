# 模块 00 · 平台底座 Platform

> 状态：**外壳真实、租户管理后端已落地、鉴权 Mock** · 对标 Segment 的 App Shell + 工作区 + IAM 壳
>
> 本轮落地：`tenant_config` / `tenant_audit` 表 + `tenants` 表生命周期扩展（均「已建」）；sql-engine 新增 `platform_api.py`（`/platform/*` 路由，已挂载于 `main.py`），实现租户 CRUD + 启停 + 每租户配置读写（dry-run 校验）+ 配置变更审计。全局验收 pytest 411P / 0F / 2S。前端管理 UI 仍待接（见 §4）。

## 1. 概述

平台底座是所有业务模块共用的「框架层」：左侧分区导航、顶栏（搜索 + Workspace 切换 + 头像）、页面骨架（标题/副标题/动作位）、UI 组件库、Mock 套件、API 客户端、主题与多租户上下文。它不承载具体业务，但决定了整套控制台「长得像 Segment、跑得通真实数据」。

## 2. 详细设计（产品）

### 2.1 子功能清单

| 功能 | 英文 | 状态 | 说明 |
|------|------|------|------|
| 分区导航 | Sidebar IA | 真实 | 8 大分区 + 设置，激活分区展开二级；中文主 + 英文术语 |
| 工作区切换 | Workspace | 真实(租户)/Mock(组织) | 顶栏切租户 1001/1002，驱动全站按 `tenant_id` 查询 |
| 租户管理 | Tenant Management | 规划 | 租户列表 + 增删改 + **每租户独立配置**（容量/通道/策略/隐私/集成）；见 §2.5 |
| 全局搜索 | Search | Mock | 顶栏搜索框占位（未接） |
| 账号/头像 | Account | Mock | 头像占位，无登录态 |
| 页面骨架 | Page Shell | 真实 | `Layout(title/subtitle/actions)` 统一页头 |
| 品牌主题 | Theme | 真实 | Segment 绿（`brand-*` 调色板）|
| Mock 标注 | MockTag | 真实 | 未接后端页面统一打角标 |

### 2.2 信息架构与页面

- 顶层分区（`lib/nav.ts` 的 `SECTIONS`）：连接 / 统一 / 对象 / 客户 / 触达 / 协议 / 隐私 / 监控；底部 `FOOTER_SECTION`：设置。
- 单页：概览 Overview（`/`，`pages/Dashboard.tsx`，真实计数）。
- 租户管理（§2.5）落在 **设置 → 租户管理**（`/settings/tenants`），属平台级治理，详见 [09-settings](./09-settings.md)。
- 骨架：`components/layout/{Layout,Sidebar,Header}.tsx`。

### 2.3 关键用户流程

1. 进入 → 默认概览，看各对象实时计数 → 点卡片进入对应模块。
2. 顶栏切 Workspace（租户）→ 全站数据随 `tenant_id` 刷新。
3. 左栏点分区 → 展开二级 → 进入功能页。

### 2.4 数据模型

本模块已落地三处 schema 变更（`sql/migrate_modules.sql`，经 `scripts/apply_migrations.sh` 应用，全部幂等）。

#### 2.4.1 `tenants` 表生命周期扩展【已建】

通过幂等存储过程 `_add_col` / `_add_idx` 为既有 `tenants` 表新增列（重复执行安全，不改 PK）：

| 列 | 类型 | 默认 | 说明 |
|----|------|------|------|
| `status` | `ENUM('active','suspended')` | `active` | 租户状态，停用后网关可拦截 |
| `scale_tier` | `VARCHAR(32)` | `dev` | dev/medium/large/xlarge，驱动容量配置 |
| `contact_email` | `VARCHAR(128)` | | 租户联系人 |
| `description` | `VARCHAR(512)` | | 租户描述 |
| `max_events_qps` | `INT` | `10000` | QPS 上限（软限） |
| `region` | `VARCHAR(64)` | | 区域 |
| `plan` | `ENUM('starter','business','enterprise')` | `business` | 套餐 |
| `slug` | `VARCHAR(128)` | | 工作区 URL 标识符 |
| `updated_at` | `DATETIME` | `CURRENT_TIMESTAMP ON UPDATE` | 更新时间 |

索引：`idx_status(status)`、`idx_slug(slug)`。基础 4 字段（`tenant_id` / `tenant_name` / `tier` / `kafka_topic`）沿用既有定义。

#### 2.4.2 `tenant_config`——每租户独立配置存储【已建】

运行时热加载，避免全局 env 污染。一行存一个 `(域, 键)` 的配置值。

| 列 | 类型 | 说明 |
|----|------|------|
| `tenant_id` | `BIGINT NOT NULL` | 租户 |
| `config_domain` | `VARCHAR(32) NOT NULL` | 配置域：基础/数据通道/容量/ID-Mapping/存储/隐私/集成/配额 |
| `config_key` | `VARCHAR(64) NOT NULL` | 如 kafka_topic / scale_tier / confidence_threshold / olap_backend |
| `config_value` | `JSON` | 字段值或嵌套配置对象 |
| `created_at` / `updated_at` | `DATETIME` | `updated_at` 带 `ON UPDATE CURRENT_TIMESTAMP` |
| `updated_by` | `VARCHAR(128)` | 更新者标识（预留鉴权） |

主键 `(tenant_id, config_domain, config_key)`；索引 `idx_domain(tenant_id, config_domain)`。`ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`。

#### 2.4.3 `tenant_audit`——配置变更审计日志【已建】

| 列 | 类型 | 说明 |
|----|------|------|
| `audit_id` | `BIGINT AUTO_INCREMENT PK` | 审计主键 |
| `tenant_id` | `BIGINT NOT NULL` | 租户 |
| `actor` | `VARCHAR(128) NOT NULL` | 操作者邮箱或 user_id（默认 `system`）|
| `action` | `VARCHAR(32) NOT NULL` | create / update / suspend / resume |
| `target` | `VARCHAR(64) NOT NULL` | 变更目标：`tenant` / `status` / 某 `config_domain` |
| `old_value` / `new_value` | `JSON` | 变更前后值（`ensure_ascii=false` 存中文） |
| `reason` | `VARCHAR(256)` | 变更原因/备注 |
| `created_at` | `DATETIME` | 默认 `CURRENT_TIMESTAMP` |

索引 `idx_tenant_time(tenant_id, created_at)`。`ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`。

> 说明：「近 24h 事件量」非新建表，由 `merge_log`（ID 合并操作）按 `tenant_id` + 时间窗实时聚合作真实代理。

- 前端无持久化；`TenantContext` 仅内存态（当前 `tenants` 写死 `[1001,1002]`，待改为从 `GET /platform/tenants` 拉取，见 §4）。

### 2.5 租户管理与每租户配置

平台支持对**多个租户**做集中治理：超级管理员维护租户清单，并为**每个租户单独配置**容量、数据通道、ID-Mapping 策略、隐私合规与集成密钥。租户之间配置互不影响——这是「多租户」从「只切 `tenant_id`」升级为「可独立运营」的关键。

#### 2.5.1 子功能

| 功能 | 说明 |
|------|------|
| 租户列表 | 展示所有租户：名称、tier、状态、scale 档位、事件量；支持搜索/筛选 |
| 新建 / 编辑租户 | 表单维护基础信息 + 各配置域；保存前 dry-run 校验（如 topic 冲突、配额合法性）|
| 启用 / 停用 | `status=active/suspended`；停用后该租户写入与查询被网关拦截 |
| 配置详情 | 单租户的「配置中心」，按配置域分 Tab（见 §2.5.2）|
| 配置变更审计 | 每次改配置落 `merge_log` 风格的审计记录（关联 [09-settings](./09-settings.md) Audit Trail）|

#### 2.5.2 每租户配置域（核心）

每个租户拥有一套独立配置，按域划分：

| 配置域 | 字段示例 | 说明 / 关联模块 |
|--------|----------|----------------|
| 基础 | `tenant_name` / `tier`(premium·standard) / `status`(active·suspended) | 租户身份与生命周期 |
| 数据通道 | `kafka_topic` / `topic_mode`(独占·共享) / 分区数 | 独占 `tenant-{id}-events` 或落到 `shared-tenant-events`（见 1003 示例）|
| 容量 / 伸缩 | `scale_tier`(dev·medium·large·xlarge) / Redis 分片 / Flink 并行度 / OLAP 副本 | 对标 [scale-comparison](../scale-comparison.md)；驱动 `scripts/scale-up.sh` 取向 |
| ID-Mapping 策略 | 合并置信度阈值 / 渠道优先级 / 是否启用算法合并 | 注入 id-mapping 服务的合并逻辑 |
| 存储 / OLAP | `OLAP_BACKEND`(mysql·doris) / 库前缀 / 数据保留期 | 后端可按租户隔离（executor 已解耦）|
| 隐私 / 合规 | 数据保留天数 / 默认同意态 / 删除 SLA | 关联 [07-privacy](./07-privacy.md) |
| 集成 | `AGENT_LLM_ENABLED` / LLM Key / destinations 凭证 | 关联 [01-connections](./01-connections.md)、NL→DSL |
| 配额 | 事件 QPS 上限 / 日导入行数 / segment 数上限 | 软/硬限额，超限告警或拒绝 |

> 设计取舍：基础 4 字段沿用现有 `tenants` 表；其余配置域统一落到新表 `tenant_config(tenant_id, domain, config JSON)` 或 `tenants` 扩展列，避免频繁改表结构。读取时按 `tenant_id` 合并出一份「有效配置」。

#### 2.5.3 关键流程

1. 管理员进入 **设置 → 租户管理** → 看租户列表。
2. 新建租户 → 填基础信息 + 选 scale 档位 → 系统建 topic、初始化 `one_id_sequence`、写 `tenant_config`。
3. 编辑某租户的「ID-Mapping 策略」Tab → 改置信度阈值 → 保存 → 审计留痕 → id-mapping 服务热加载新配置。
4. 停用租户 → 网关对该 `tenant_id` 的请求返回 403。

#### 2.5.4 真实 vs Mock 边界

- 现状（本轮后）：`tenant_config` / `tenant_audit` 表【已建】，后端 `/platform/*` CRUD + 配置读写 + 审计【已落地】；**前端管理 UI 仍未接**，全局 env（`OLAP_*`/`AGENT_LLM_ENABLED`/scale 脚本）尚未真正「下沉」消费配置表。
- 落地目标（剩余）：前端管理 UI；让 id-mapping / executor / scale 脚本按 `tenant_id` 读取有效配置，取代全局 env。

## 2.6 逻辑设计（后端，本轮落地）

实现位于 `services/sql-engine/platform_api.py`：自带 `APIRouter(prefix="/platform")`（变量 `router`）+ 本模块私有 Pydantic 模型（刻意不写进 `schemas.py`），`main.py` 第 49/498 行 `import` 并 `include_router`。`PlatformService` 复用 `MysqlOlapExecutor().config` 取连接，全部参数化 SQL，读写按 `tenant_id` 隔离——不手拼 SQL、不改既有 service。经网关访问前缀为 `/api/platform/*`（nginx 剥 `/api`）。

### 2.6.1 端点列表

| Method | Path | 请求 | 响应 |
|--------|------|------|------|
| GET | `/platform/tenants` | query: `search` / `tier` / `status` / `limit`(1–200,默认50) / `offset` | `{tenants:[{tenant_id,tenant_name,tier,status,scale_tier,contact_email,created_at,updated_at,events_count_24h}], total}` |
| POST | `/platform/tenants` | `TenantCreate{tenant_name, tier="standard", scale_tier="dev", contact_email?, description?, actor?}` | `{tenant_id, tenant_name, status, created_at}` |
| GET | `/platform/tenants/{tenant_id}` | path | 租户详情 + `config_summary{域:键数}`；404 不存在 |
| PUT | `/platform/tenants/{tenant_id}` | `TenantUpdate{tenant_name?, tier?, scale_tier?, contact_email?, description?, actor?}`（部分更新）| `{tenant_id, updated_at}`；404 |
| PATCH | `/platform/tenants/{tenant_id}` | `TenantStatusPatch{status: active\|suspended, reason?, actor?}` | `{tenant_id, status, updated_at}`；400 非法 status / 404 |
| GET | `/platform/tenants/{tenant_id}/config` | query: `domain?` | `{tenant_id, 基础{...}, 数据通道{...}, ...}`（按域合并）；404 |
| PUT | `/platform/tenants/{tenant_id}/config` | `TenantConfigUpdate{domain, updates:{key:value}, reason?, actor?}` | `{tenant_id, domain, updated_keys, updated_at}`；400 非法域/冲突 / 404 |
| GET | `/platform/audit/tenant-config` | query: `tenant_id?` / `actor?` / `action?` / `limit` / `offset` | `{audits:[{audit_id,tenant_id,actor,action,target,old_value,new_value,reason,created_at}], total}` |

配置域常量 `CONFIG_DOMAINS = [基础, 数据通道, 容量, ID-Mapping, 存储, 隐私, 集成, 配额]`。

### 2.6.2 核心算法 / 流程

- **创建租户**：`tenant_id` 非自增，取 `MAX(tenant_id)+1`（≥1001）；自动建 `kafka_topic = tenant-{id}-events`；`INSERT IGNORE` 初始化 `one_id_sequence`(next_id=100000)；写入「数据通道.kafka_topic」「容量.scale_tier」两条初始配置；落 `create` 审计。
- **有效配置合并**（`get_config`）：「基础」域恒从 `tenants` 主表派生（tenant_name/tier/status/scale_tier/contact_email/kafka_topic/description），其余 7 域从 `tenant_config` 按行装配，`config_value` 做 JSON 反序列化；未配置的域返回空对象占位。
- **配置 dry-run 校验**（`update_config`）：写前校验 `domain ∈ CONFIG_DOMAINS`、`updates` 非空；「数据通道.kafka_topic」校验全局唯一（与其它租户冲突则 400）。写用 `INSERT ... ON DUPLICATE KEY UPDATE`（幂等 upsert），并把「容量.scale_tier」「数据通道.kafka_topic」回写同步到 `tenants` 主表，保证两处一致。
- **生命周期**（`set_status`）：status 仅允许 active/suspended，映射为 `resume`/`suspend` 审计动作。
- **审计**：所有写操作（create/update/suspend/resume）统一经 `_audit()` 落 `tenant_audit`，记录 old/new JSON（`ensure_ascii=false` 存中文）。

### 2.6.3 与其他模块依赖

- **依赖**：`executor.MysqlOlapExecutor`（取连接/配置）、既有 `tenants` / `one_id_sequence` / `merge_log` 表。
- **被依赖 / 关联**：[09-settings](./09-settings.md) 的 `settings_api.py` 复用 `tenant_config`（基础域读写共用同一存储）；停用态供网关拦截使用（规划）；配置「下沉」后供 id-mapping / executor / scale 脚本按租户消费（规划）。

## 3. 技术设计

### 3.1 前端

| 关注点 | 实现 |
|--------|------|
| 路由 | `App.tsx`（react-router v6，`BASENAME` dev=`/` / prod=`/console`）|
| 导航数据 | `lib/nav.ts`（`HOME` / `SECTIONS` / `FOOTER_SECTION`，类型 `NavSection`/`NavChild`）|
| 骨架 | `Layout` 包 `Sidebar` + `Header` + `<main>`（`max-w-7xl` 容器）|
| 多租户 | `context/TenantContext.tsx`（`useTenant()` 提供 `tenant/setTenant/tenants`）|
| 主题 | `tailwind.config.js` 的 `brand` 调色板（绿）；组件统一用 `brand-*` |
| UI 库 | `components/ui.tsx`：`Card/Badge/Button/DataTable(含 rowLink)/Modal/TextField/Spinner` |
| Segment 套件 | `components/segment/kit.tsx`：`MockTag/StatCards/StatusPill/Catalog/Timeline/EmptyState/SubTabs/Sparkline` |
| API 客户端 | `api/client.ts`（axios，baseURL `/api`，45s 超时）；类型 `api/types.ts` |

### 3.2 后端

- 网关 **Nginx :8080**：`/console/` 托管前端，`/api/*` 反代到 SQL Engine `:8002`。
- 鉴权：**当前无**。Workspace 切换只是前端切 `tenant_id`，无登录、无权限校验。
- 租户管理（**后端已落地**）：sql-engine `platform_api.py` 暴露 `/platform/tenants` CRUD + `PATCH` 启停 + `/platform/tenants/{id}/config` 读写 + `/platform/audit/tenant-config`（详见 §2.6）。`tenants` 扩展列 + `tenant_config` / `tenant_audit` 表经 `scripts/apply_migrations.sh` 迁移（强制 `utf8mb4`）。写操作的超级管理员鉴权仍待 [09-settings](./09-settings.md) IAM（当前 `actor` 由请求体传入，预留）。

### 3.3 真实 vs Mock 边界

- 真实：导航、租户切换、页面骨架、主题、概览计数；**租户管理后端**（CRUD/启停/每租户配置/审计，§2.6）+ `tenant_config` / `tenant_audit` 表。
- Mock / 规划：顶栏搜索、头像/登录态、组织级 Workspace（多租户已有，但无「组织/成员」概念）、**租户管理前端 UI**（后端已就绪，UI 未接）、**配置「下沉」消费**（配置已可存取，但 id-mapping/executor/scale 尚未按租户读取，仍用全局 env）。

### 3.4 依赖与集成

- 被所有业务模块依赖（页面都用 `Layout` + `ui`/`kit`）。
- 与 [09-settings](./09-settings.md) 的 IAM 强相关（真实鉴权落地在 Settings 模块）。

## 4. TODOs

**P0（让底座可登录、可治理）**
- [ ] [后端] 引入鉴权服务：登录、会话/JWT、`tenant_id` 从令牌解析（取代前端硬切）。
- [ ] [前端] 登录页 + 路由守卫 + 401 拦截（axios 拦截器）。
- [ ] [前端] 顶栏头像接真实用户；Workspace 列表来自后端 `GET /tenants` 而非写死 `[1001,1002]`。
- [x] [后端] 新增 `tenant_config` / `tenant_audit` 表 + `tenants` 扩展列 + 迁移（§2.4）；`/platform/tenants` CRUD 与 `/platform/tenants/{id}/config` 读写 + 审计接口（§2.6）。
- [ ] [后端] 配置「下沉」：`OLAP_*` / `AGENT_LLM_ENABLED` / scale 档位等全局 env 改为按 `tenant_id` 读取 `tenant_config` 有效配置（存储已就绪，消费侧未接）。
- [ ] [前端] 设置 → 租户管理页：租户列表 + 新建/编辑 + 各配置域 Tab + 启停 + 变更审计（接 `/platform/*` 端点）。
- [ ] [后端] 停用态拦截：网关/中间件对 `status=suspended` 租户的请求返回 403。

**P1（体验与健壮性）**
- [ ] [前端] 全局搜索接 `objects/search` 跨对象（Sources/Audiences/Profiles）。
- [ ] [前端] 错误边界 + 统一 Toast；移动端折叠侧栏（当前 `lg:` 才显示）。
- [ ] [前端] 面包屑 + 页面级 loading skeleton。

**P2（打磨）**
- [ ] [前端] 暗色主题；i18n 抽出中英文案。
- [ ] [前端] `DataTable` 升级：分页、排序、列配置、CSV 导出。
- [ ] [前端] 把 `mock/data.ts` 按模块拆分，便于各模块独立维护。
