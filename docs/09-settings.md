# 模块 09 · 设置 Settings

> 状态：**后端已落地（IAM 全链路 CRUD + 审计，未接平台鉴权）/ 前端待接入** · 对标 Segment Settings
> 后端：`services/sql-engine/settings_api.py`（自带 `APIRouter` + `SettingsService` + Pydantic，已在 `main.py:507` 挂载）。
> 库表：`sql/migrate_modules.sql` 已建 `users/roles/user_roles/teams/team_members/api_tokens/api_token_usage/audit_log/invitations`（均 `CREATE TABLE IF NOT EXISTS`，utf8mb4）。
> 验收：全局 pytest **411P / 0F / 2S**。当前缺口：无登录态/会话，写操作 `actor` 多为 `system`，权限 scope 仅落库未在接口层强制。

## 1. 概述

设置模块是工作区的「治理中枢」，对标 Segment 的 Settings / IAM：管理**工作区信息**、**成员与角色（IAM）**、**API 令牌**、**审计日志**四类内容。它是整套 CDP 的安全与多租户治理落点——其他模块的「谁能看/谁能改」最终都由这里定义。

**本轮后端已落地**：IAM 全链路（成员/角色/团队/邀请/API 令牌/审计）的真实表与 CRUD 端点已可用，所有写操作自动埋点到 `audit_log`，按 `tenant_id` 隔离，SQL 全参数化。**前端仍为 Mock**：四个页面共享顶部 `SubTabs` 子导航，仍读 `mock/data.ts`，待接 `/api/iam/*` 与 `/api/tenants/*`。本模块与 [00-platform](./00-platform.md) 的鉴权 P0 **强绑定**：平台底座负责「登录/会话/JWT」，本模块负责「用户/角色/团队/令牌/审计」的数据与策略；二者合起来才构成完整 IAM。目前缺登录态，故写操作的 `actor` 暂记 `system`、scope 仅落库未在接口层强制，待鉴权先行后补齐。

## 2. 详细设计（产品）

### 2.1 子功能清单

| 功能 | 英文 | 状态 | 说明 |
|------|------|------|------|
| 工作区信息 | General | Mock（tenants 可接真） | 名称/slug/区域/套餐/创建时间/归属租户；只读展示 |
| 权限管理 | Access Management | Mock | 成员列表、角色列表、权限范围；邀请成员入口 |
| 成员管理 | Members / IAM Users | Mock | 姓名/邮箱/角色/团队/状态；增删改、停用 |
| 角色与权限 | Roles & Scopes | Mock | 角色定义、成员数、权限范围（RBAC 雏形）|
| 团队 | Teams | Mock | 把成员分组到团队，按团队授予资源范围 |
| 邀请成员 | Invite Member | Mock | 邮箱邀请 + 指定角色/团队，生成邀请链接 |
| API 令牌 | API Tokens | Mock | 服务端访问凭证：标签/前缀/权限范围/创建/最近使用 |
| 令牌签发/吊销 | Issue / Revoke Token | Mock | 生成时仅展示一次明文，存储 hash；可吊销 |
| 审计日志 | Audit Trail | Mock | 工作区内关键写操作记录：时间/操作者/动作/对象 |

### 2.2 信息架构与页面

四页同属设置区（`lib/nav.ts` 的 `FOOTER_SECTION`），共享顶部 `SubTabs`（`components/segment/kit.tsx`）做子页切换。

| 路由 | 页面文件 | 说明 | 状态 |
|------|---------|------|------|
| `/settings` | `pages/segment/SettingsGeneralPage.tsx` | 通用 General：工作区基本信息与归属租户（只读 `dl`）| Mock |
| `/settings/access` | `pages/segment/AccessPage.tsx` | 权限管理：成员表 + 角色表 + StatCards + 邀请按钮 | Mock |
| `/settings/tokens` | `pages/segment/TokensPage.tsx` | API 令牌：令牌表 + 生成按钮 | Mock |
| `/settings/audit` | `pages/segment/AuditPage.tsx` | 审计日志：操作记录表（时间/操作者/动作/对象）| Mock |

> 四页 `TABS` 常量重复定义（各文件内联），接真前可抽出共享。每页右上 `MockTag` 角标标注未接后端。

### 2.3 关键用户流程

**A. 邀请成员 / 分配角色**
1. `/settings/access` 点「邀请成员」→ 填邮箱、选角色（如 管理员/编辑/只读）、可选团队。
2. 提交 → `POST /api/iam/invitations`（**待建**）→ 生成邀请令牌与链接，发邮件/复制链接。
3. 受邀人接受 → 创建/绑定 `users` 记录，写 `user_roles`；状态从「待接受」转「活跃」。
4. 全程写 `audit_log`（actor=邀请人，action=`invite_member`，target=受邀邮箱）。

**B. 签发 API 令牌**
1. `/settings/tokens` 点「生成令牌」→ 填标签、勾选权限范围（scopes，如 `read:profiles`/`write:segments`）。
2. `POST /api/iam/tokens`（**待建**）→ 后端生成随机串，**仅本次返回明文**，库内只存 `hash` + `prefix` + `scopes`。
3. 列表展示 prefix（前 8 位）、scopes、创建/最近使用时间；可「吊销」(`DELETE /api/iam/tokens/{id}`)。
4. 写审计：`issue_token` / `revoke_token`。

**C. 查审计日志**
1. `/settings/audit` 默认按时间倒序展示工作区内写操作。
2. 可按操作者/动作/时间范围/对象筛选（`GET /api/iam/audit?actor=&action=&from=&to=`，**待建**）。
3. 仅可读、不可改；分页/导出 CSV（P2）。

**D. 改工作区信息**
1. `/settings` 展示工作区元数据（来源应为 `tenants` 表）。
2. 可改的字段（名称/区域/套餐）经 `PATCH /api/tenants/{id}`（**待建写接口**）落库；slug/创建时间只读。
3. 写审计：`update_workspace`。

### 2.4 数据模型

下表为本模块在 `sql/migrate_modules.sql`（09 · settings 段，第 879 行起）已落地的真实 DDL 要点，均 `CREATE TABLE IF NOT EXISTS` + `ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`，经 `scripts/apply_migrations.sh` 应用。

| 表 | 状态 | 关键字段（类型 / 键 / 索引） | 说明 |
|----|------|------------------------------|------|
| `tenants` | **已存在（00-platform 扩展）** | `tenant_id/tenant_name/tier/kafka_topic/created_at`（原表）；扩展列 `status ENUM('active','suspended')`、`scale_tier`、`region`、`plan ENUM('starter','business','enterprise')`、`slug`、`updated_at`；`idx_status`、`idx_slug` | 工作区真实来源。**注意**：本模块 `get_tenant/update_tenant` 实际把 `slug/region/plan` 读写在 `tenant_config(基础)`，而非扩展列，避免与 00-platform 写法冲突 |
| `users` | **已建** | `id BIGINT PK AI`, `tenant_id`, `email VARCHAR(255)`, `name`, `status ENUM('active','inactive','pending') DEFAULT 'active'`, `created_at/updated_at`；唯一键 `uk_tenant_email(tenant_id,email)`；`idx_tenant`、`idx_status(tenant_id,status)` | 工作区成员；租户内 email 唯一 |
| `roles` | **已建** | `id PK`, `tenant_id`, `name`, `scope JSON NOT NULL`(RBAC 权限范围), `member_count INT`, 时间戳；唯一键 `uk_tenant_name`；`idx_tenant` | 角色定义；`scope` 存 `{modules, permissions}` |
| `user_roles` | **已建** | `user_id`+`role_id` 复合 PK, `assigned_at`；`idx_role` | 成员↔角色多对多 |
| `teams` | **已建** | `id PK`, `tenant_id`, `name`, `description`, 时间戳；唯一键 `uk_tenant_name`；`idx_tenant` | 团队 |
| `team_members` | **已建** | `team_id`+`user_id` 复合 PK, `joined_at`；`idx_user` | 团队↔成员多对多 |
| `api_tokens` | **已建** | `id PK`, `tenant_id`, `label`, `prefix VARCHAR(16)`(前8位), `hash VARCHAR(255)`(SHA-256，不存明文), `scopes JSON`, `created_by`, `created_at`, `last_used`, `revoked_at`；唯一键 `uk_tenant_prefix`；`idx_tenant_active(tenant_id,revoked_at)`、`idx_last_used` | 服务端令牌；只存 hash，吊销以 `revoked_at` 软标记 |
| `api_token_usage` | **已建** | `id PK`, `token_id`, `tenant_id`, `requests_24h`, `requests_30d`, `last_ip`, `last_ua`, `updated_at`；唯一键 `uk_token(token_id)`；`idx_tenant` | 令牌使用统计（表已建，埋点 P2） |
| `audit_log` | **已建** | `id PK`, `tenant_id`, `actor VARCHAR(255)`, `action VARCHAR(64)`, `target VARCHAR(256)`, `module VARCHAR(64)`, `details JSON`, `ip_addr`, `user_agent`, `created_at`；`idx_tenant_time`、`idx_actor(tenant_id,actor,created_at)`、`idx_action(tenant_id,action,created_at)` | 工作区操作审计；本模块所有写操作经 `_audit()` 落此表 |
| `invitations` | **已建** | `id PK`, `tenant_id`, `email`, `role_id`, `token VARCHAR(255)`, `status ENUM('pending','accepted','declined','expired')`, `invited_by`, `expires_at`, `accepted_at`, `created_at`；唯一键 `uk_token`；`idx_tenant_status(tenant_id,status,expires_at)`、`idx_email` | 成员邀请；token 唯一，默认 7 天过期 |

> 所有表均带 `tenant_id`，索引/唯一键以 `tenant_id` 前缀，按租户隔离（沿用全局多租户约定）。另有 00-platform 段的 `tenant_config`（每租户配置，PK `(tenant_id,config_domain,config_key)`）与 `tenant_audit`（配置变更审计）——General 页的 slug/region/plan 即存于 `tenant_config(基础)`。Mock 字段对照：`workspaceInfo`→`tenants`+`tenant_config`；`iamUsers`→`users`+`user_roles`+`team_members`；`roles`→`roles`；`apiTokens`→`api_tokens`；`auditTrail`→`audit_log`。

### 2.5 逻辑设计（已落地后端）

后端集中于 `services/sql-engine/settings_api.py`：单文件自带 `APIRouter`（无 prefix）+ `SettingsService` + Pydantic 模型，复用 `MysqlOlapExecutor` 取连接配置，`autocommit=True`。`router` 在 `main.py:507` 经 `include_router` 挂载。前端契约为 `/api/iam/*` 与 `/api/tenants/*`，nginx 剥离 `/api` 后 sql-engine 实收 `/iam/*` 与 `/tenants/*`，故路径直接如此声明。

#### 端点列表

工作区（tenants）：

| 方法 | 路径 | 请求 | 响应 |
|------|------|------|------|
| GET | `/tenants/{tenant_id}` | 路径参数 | `{id,name,slug,region,plan,created_at,tier,kafka_topic}`；404 工作区不存在 |
| PATCH | `/tenants/{tenant_id}` | body `{name?,region?,plan?}`，query `actor=system` | 同上 + `updated_at`；写审计 `action=update target=workspace` |

成员（users）：

| 方法 | 路径 | 请求 | 响应 |
|------|------|------|------|
| GET | `/iam/users` | query `tenant_id*`,`limit≤200`,`offset`,`status?` | `{total,data:[{id,email,name,status,created_at,role,teams[]}]}`（多对多用 `GROUP_CONCAT` 聚合） |
| POST | `/iam/users` | body `{tenant_id,email,name?,role_id?}` | `{id,email,name,status:'pending'}`；可选挂角色并刷新 `member_count` |
| PATCH | `/iam/users/{user_id}` | body `{name?,status?}`，query `tenant_id?` | 更新后行；status 非法→400，不存在→404 |
| DELETE | `/iam/users/{user_id}` | query `tenant_id?` | `{ok:true}`；级联清 `user_roles`/`team_members` |

角色（roles）：

| 方法 | 路径 | 请求 | 响应 |
|------|------|------|------|
| GET | `/iam/roles` | query `tenant_id*` | `{data:[{id,name,scope,member_count}]}`（`member_count` 子查询实时统计） |
| POST | `/iam/roles` | body `{tenant_id,name,scope{}}` | 新建角色行 |
| PATCH | `/iam/roles/{role_id}` | body `{name?,scope?}`，query `tenant_id?` | 更新后行 |
| DELETE | `/iam/roles/{role_id}` | query `tenant_id?` | `{ok:true}`；级联清 `user_roles` |

团队（teams）：

| 方法 | 路径 | 请求 | 响应 |
|------|------|------|------|
| GET | `/iam/teams` | query `tenant_id*` | `{data:[{id,name,description,member_count}]}` |
| POST | `/iam/teams` | body `{tenant_id,name,description?}` | 新建团队行 |
| POST | `/iam/teams/{team_id}/members` | body `{user_id}` | `{ok:true}`（`INSERT IGNORE` 幂等） |
| DELETE | `/iam/teams/{team_id}/members/{user_id}` | 路径参数 | `{ok:true}`；不在团队→404 |

邀请（invitations）：

| 方法 | 路径 | 请求 | 响应 |
|------|------|------|------|
| POST | `/iam/invitations` | body `{tenant_id,email,role_id,invited_by?,teams?}` | `{id,token,email,expires_at,invitation_url}` |
| GET | `/iam/invitations` | query `tenant_id*`,`status?` | `{data:[{id,email,role,status,expires_at,invited_by}]}`（join roles/users） |
| POST | `/iam/invitations/{token}/accept` | body `{name?}` | `{user_id,status:'active'}`；已处理/过期→400，token 无效→404 |
| DELETE | `/iam/invitations/{invitation_id}` | query `tenant_id?` | `{ok:true}` |

API 令牌（tokens）：

| 方法 | 路径 | 请求 | 响应 |
|------|------|------|------|
| GET | `/iam/tokens` | query `tenant_id*`,`limit`,`offset` | `{total,data:[{id,label,prefix,scopes,created_at,last_used,revoked_at}]}`（不返 hash/明文） |
| POST | `/iam/tokens` | body `{tenant_id,label,scopes[],created_by?}` | `{id,label,token_plaintext,prefix,created_at}`——**明文仅此一次返回** |
| DELETE | `/iam/tokens/{token_id}` | query `tenant_id?` | `{ok:true,revoked_at}`（软吊销，置 `revoked_at`） |

审计（audit）：

| 方法 | 路径 | 请求 | 响应 |
|------|------|------|------|
| GET | `/iam/audit` | query `tenant_id*`,`actor?`,`action?`,`target?`,`from?`,`to?`,`limit≤500`,`offset` | `{total,data:[{id,time,actor,action,target,module,details}]}`（`target` 模糊匹配，时间窗过滤） |
| POST | `/iam/audit` | body `{tenant_id,actor,action,target,module?,details?}` | `{id,created_at}`——供其他模块统一上报审计 |

#### 核心算法 / 流程

- **统一审计埋点** `_audit(cur, tenant_id, actor, action, target, module, details)`：本模块每个写操作（建/改/删成员·角色·团队、邀请、签发/吊销令牌、改工作区）在同一事务游标内 `INSERT audit_log`，`details` 以 `json.dumps(ensure_ascii=False)` 存中文 JSON。当前 `actor` 多为 `system`（缺登录态）。
- **令牌签发** `issue_token`：`secrets.token_urlsafe(32)` → 明文 `sk_<raw>`，取前 8 位为 `prefix`，`hashlib.sha256(明文).hexdigest()` 为 `hash`；库内仅存 `prefix+hash+scopes`，响应回 `token_plaintext` 一次。吊销为软删（置 `revoked_at`，列表仍可见）。
- **邀请流程** `create_invitation`→`accept_invitation`：建邀请时 `token_urlsafe(32)` + `expires_at=now+7d`、状态 `pending`；接受时校验状态/过期（过期则置 `expired` 并报错），`INSERT ... ON DUPLICATE KEY UPDATE` 幂等落 `users`（status→active）、`INSERT IGNORE` 挂角色、刷新 `member_count`、邀请置 `accepted`。
- **成员聚合查询** `list_users`：左连 `user_roles/roles` 与 `team_members/teams`，`GROUP_CONCAT(DISTINCT ...)` 聚合角色与团队名，Python 侧拆成 `role`（取首个）与 `teams[]`。
- **租户读写**：`get_tenant` 读原 `tenants`(tenant_id/tenant_name/tier/kafka_topic/created_at) 并叠加 `tenant_config(基础)` 的 slug/region/plan；`update_tenant` 改 `tenant_name` 落表、region/plan 落 `tenant_config`，再写审计。
- **多租户与安全**：所有列表/统计强制带 `tenant_id`；以 PK 定位的 PATCH/DELETE 可选叠加 `tenant_id` 校验（传入则越租户返回 404/false）。SQL 全部 `%s` 参数化，绝不字符串拼接 SQL。

#### 与其他模块依赖

- **被全站依赖（审计中枢）**：`audit_log` + `POST /iam/audit` 设计为全站写操作的统一上报入口，`module` 字段区分来源（settings/engage/privacy…），本模块的 `GET /iam/audit` 是其查询视图。
- **依赖 00-platform**：真实 `actor`、会话、`tenant_id` 解析需平台鉴权先行；General 页 slug/region/plan 复用 00-platform 的 `tenant_config`。
- **被令牌校验依赖（待接）**：`api_tokens`(prefix/hash/scopes) 供网关或 SQL Engine 中间件按 scope 鉴权，与 01-connections 的 `write_key` 同源思路。

## 3. 技术设计

### 3.1 前端

| 关注点 | 实现 |
|--------|------|
| 页面 | 4 个 Mock 页（`SettingsGeneralPage`/`AccessPage`/`TokensPage`/`AuditPage`）|
| 子导航 | 顶部 `SubTabs`（`components/segment/kit.tsx`），4 个 tab 指向四路由，`active` 标当前页 |
| 数据源 | 全部读 `mock/data.ts`：`workspaceInfo`/`iamUsers`/`roles`/`apiTokens`/`auditTrail` |
| 组件 | `Layout`（页头/动作位）、`Card`、`DataTable`、`StatCards`（Access 页用）、`MockTag` |
| 动作 | 「邀请成员」「生成令牌」按钮目前为占位（无 onClick 行为）|
| 接真改造 | 引入 `api/client.ts` 调 `/api/iam/*` 与 `/api/tenants/*`；按 `useTenant()` 带 `tenant_id`；表单弹窗用 `ui.tsx` 的 `Modal`/`TextField` |

### 3.2 后端

**已落地**，集中于 `services/sql-engine/settings_api.py`（挂在 SQL Engine `:8002`，未独立服务），统一前缀经 nginx 后为 `/api/iam`、`/api/tenants`。端点逐一见 §2.5。状态汇总：

| 端点 | 方法 | 状态 | 说明 |
|------|------|------|------|
| `/api/iam/users` | GET/POST/PATCH/DELETE | **已建** | 成员 CRUD、停用，多对多聚合 role/teams |
| `/api/iam/roles` | GET/POST/PATCH/DELETE | **已建** | 角色与权限范围 CRUD，member_count 实时统计 |
| `/api/iam/teams` | GET/POST + members 增删 | **已建** | 团队 CRUD 与成员增删 |
| `/api/iam/invitations` | POST/GET/accept/DELETE | **已建** | 邀请签发、列表、接受、撤销 |
| `/api/iam/tokens` | GET/POST/DELETE | **已建** | 令牌签发（仅一次返明文）、列表、软吊销 |
| `/api/iam/audit` | GET/POST | **已建** | 审计查询（actor/action/from/to/target 过滤、分页）+ 上报 |
| `/api/tenants/{id}` | GET/PATCH | **已建** | 工作区信息读写（slug/region/plan 经 tenant_config）|

**令牌校验（待接）**：服务端令牌（`api_tokens`）拟在 **Nginx 网关**或 **SQL Engine 中间件**统一拦截校验——按 `prefix` 定位、比对 `hash`、检查 `scopes` 是否覆盖目标操作、更新 `last_used`，校验失败返回 401/403。当前仅完成签发/吊销与存储，校验中间件尚未接入。用户态会话（登录 JWT）由 00-platform 的鉴权服务签发，二者共存：JWT 走人，token 走机器/服务端。

### 3.3 真实 vs Mock 边界

| 维度 | 现状 | 接真路径 |
|------|------|---------|
| 工作区信息 | **后端真**（`tenants`+`tenant_config`）/ 前端 Mock | 前端 General 接 `GET/PATCH /api/tenants/{id}` |
| 成员/角色/团队 | **后端真**（表+CRUD 已建）/ 前端 Mock | 前端 Access 页接 `/api/iam/users|roles|teams` |
| API 令牌 | **后端真**（hash 存储、明文一次返回）/ 前端 Mock | 前端 Tokens 页接 `/api/iam/tokens` + 明文一次展示弹窗；**网关 scope 校验中间件待接** |
| 审计日志 | **后端真**（`audit_log`，本模块写操作已埋点）/ 前端 Mock | 前端 Audit 页接 `/api/iam/audit`；其他模块统一调 `POST /api/iam/audit` 上报 |
| 鉴权/权限校验 | **仍没有**（`actor=system`、scope 仅落库未强制）| 由 00-platform 鉴权 P0 先行，本模块在其上做 RBAC 与接口层强制 |

### 3.4 依赖与集成

- **与 00-platform 鉴权 P0 强绑定**：必须先有「登录 + 会话/JWT + `tenant_id` 从令牌解析」，本模块的 IAM 才有意义；否则成员/角色无主体、审计无 actor。本模块是真实鉴权的**数据与策略层**，平台底座是**入口与会话层**。
- **审计贯穿全站**：`audit_log` 不止记录本模块——所有模块的写操作（建连接、改受众、跑 ETL、删数据等）都应统一埋点到审计服务，本模块只是其**查询视图**。
- **令牌在网关校验**：服务端调用 `/api/*` 携带 API 令牌，在 **Nginx 网关 / SQL Engine 中间件**按 `scopes` 鉴权，与全局数据链路（前端 `/api/*` → SQL Engine `:8002` → MySQL `:3308`）对齐。
- **多租户隔离**：所有 IAM 表带 `tenant_id`，沿用顶栏 Workspace 切换（1001/1002）的隔离约定。

## 4. TODOs

**P0（让 IAM 可用，紧随平台鉴权）**
- [x] [后端] 建 `users`/`roles`/`user_roles` 表与 `/api/iam/users`、`/api/iam/roles` CRUD。（settings_api.py）
- [x] [数据] 落 `tenants` 写接口（`PATCH /api/tenants/{id}`），General 可接真。
- [x] [后端] 建 `api_tokens`(hash/scopes/last_used) + 签发/吊销端点。**剩余**：令牌在 Nginx 网关或 SQL Engine 中间件校验 scopes（待登录态/中间件）。
- [x] [后端] 建 `audit_log`，本模块所有写操作经 `_audit()` 落审计 + 开放 `POST /api/iam/audit` 供他模块上报。**剩余**：统一中间件自动埋点。
- [ ] [前端] General 与 Access 页接 `/api/tenants`、`/api/iam/*`，去掉 `MockTag`；按 `useTenant()` 带 `tenant_id`。

**P1（完善 IAM 流程）**
- [x] [后端] 邀请流程：`invitations` 表 + `POST /api/iam/invitations` + 接受/撤销端点（token + 7 天过期）。**剩余**：邮件发送/链接分发。
- [ ] [前端] 邀请成员/生成令牌弹窗（`Modal`+`TextField`）；令牌明文「仅展示一次」+ 复制。
- [x] [后端] 团队：`teams`/`team_members` + CRUD 与成员增删。**剩余**：按团队授资源范围。
- [ ] [前端] 审计页接 `/api/iam/audit`，支持 actor/action/时间/对象筛选与分页。
- [ ] [前端] 抽出共享的 `TABS` 常量与 SubTabs 包装，消除四页重复。

**P2（治理打磨）**
- [ ] [后端] 细粒度 RBAC：scope 按「模块×动作」建模（`scope` 已落库），接口层统一鉴权装饰器强制。
- [ ] [前端] 审计日志 CSV 导出；成员/令牌列表分页与排序（后端已支持 limit/offset）。
- [ ] [后端] 令牌轮换、过期策略；`api_token_usage`(IP/UA/请求量) 表已建，待埋点写入。
- [ ] [前端] SSO/SCIM 占位入口（对标 Segment 企业版），SAML/OIDC 预留。
