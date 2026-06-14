# 模块 07 · 隐私 Privacy

> 状态：**后端已落地（合规闭环骨架）/ 前端待接真** · 对标 Segment Privacy
> 后端：`services/sql-engine/privacy_api.py`（`APIRouter` prefix `/privacy`，已 `include_router` 进 main.py）已实现 PII 扫描+规则 CRUD、同意分类+主体同意记录、删除/抑制工单+执行器+审计、抑制校验，共 16 个端点；6 张表均已建于 MySQL `:3308`。前端三页仍为 Mock，未切 API。全局验收 pytest 411P/0F/2S。

## 1. 概述

隐私模块是 CDP 的「合规中枢」，对标 Twilio Segment 的 Privacy。它解决三件事：**PII / 敏感字段的检测与管控**（哈希/阻断/明文）、**同意（Consent）的采集与厂商映射**（控制数据可流向哪些目的地）、**数据主体的删除与抑制请求**（GDPR/CCPA 的 Right to Erasure + Suppression）。

当前三页全部为前端 Mock，仅展示静态表格与统计卡片，无任何后端、无持久化、无执行逻辑。本文给出从 Mock 到「真实可合规」的落地路径。关键约束：**删除/抑制必须跨模块联动**——身份与画像表（`id_mapping`、`doris_user_wide`、`object_*`、`merge_log`）由 [02-unify](./02-unify.md) 的 id-mapping 服务拥有，隐私模块不直接持有这些表的写权限，删除执行器须经其接口或协同事务完成。

## 2. 详细设计（产品）

### 2.1 子功能清单

> 状态：**后端已建** = API + 表已落地可用；**前端 Mock** = 页面仍渲染静态数据未切 API。

| 功能 | 英文 | 状态 | 说明 |
|------|------|------|------|
| PII 字段管控 | Data Controls | 后端已建 / 前端 Mock | 列出受管字段，按字段配置处理动作（哈希/阻断/明文）与生效范围 |
| PII 自动检测 | PII Detection | 后端已建 / 前端 Mock | 扫描对象字段+user 身份列，启发式标记疑似 PII |
| 同意分类 | Consent Categories | 后端已建 / 前端 Mock | 维护同意分类、是否必选、授权率、厂商数 |
| 厂商映射 | Vendor Mapping | 后端已建（vendor_list）/ 前端 Mock | 把同意分类映射到下游目的地厂商，控制数据流向 |
| 同意采集/查询 | Consent Collection | 后端已建 | 记录/查询每个主体对各分类的授权状态 |
| 删除请求 | Deletion / Erasure | 后端已建 / 前端 Mock | 受理 GDPR 删除请求并执行，跟踪处理进度 |
| 抑制请求 | Suppression | 后端已建 | 标记主体进入抑制名单 + 校验端点（入口侧待挂钩）|
| 合规审计 | Audit Trail | 后端已建 | 记录每次删除/抑制/同意变更的执行明细与回执 |

### 2.2 信息架构与页面

| 路由 | 页面文件 | 说明 | 状态 |
|------|----------|------|------|
| `/privacy` | `pages/segment/DataControlsPage.tsx` | 数据管控：PII 字段表 + 受管/检测/阻断/明文统计卡 | Mock |
| `/privacy/consent` | `pages/segment/ConsentPage.tsx` | 同意管理：分类表（是否必选/同意率/厂商数）+ 统计卡 | Mock |
| `/privacy/deletion` | `pages/segment/DeletionPage.tsx` | 删除与抑制：请求表（ID/主体/类型/时间/状态）+「新建删除请求」按钮（未接） | Mock |

- 三页均用 `Layout` + `components/ui` 的 `DataTable`/`Card` + `components/segment/kit` 的 `StatCards`/`MockTag`。
- Mock 数据来自 `frontend/src/mock/data.ts`：`piiFields`、`consentCategories`、`deletionRequests`。

### 2.3 关键用户流程

**流程 A · PII 检测 → 标记动作**
1. 运营进入 `/privacy`，触发/查看 PII 扫描结果（扫 `object_*` 的字段与事件 `properties`）。
2. 系统按规则库标记疑似字段，给出「检测方式 = 自动/手动」与建议类别（邮箱/手机/身份证…）。
3. 运营对每个字段选处理动作：**哈希**（落库前不可逆摘要）/ **阻断**（直接丢弃，不入库）/ **明文**（放行）。
4. 配置 `scope`（生效范围：全部来源 / 指定 Source / 指定对象），保存为规则，后续入库管线据此生效。

**流程 B · 同意采集 → 映射厂商**
1. 管理员定义同意分类（如「广告投放」「个性化推荐」），标注是否必选。
2. 把分类映射到下游厂商/目的地（决定数据能流向谁）。
3. 端侧/服务端通过同意采集 API 写入每个主体的授权状态（granted/withdrawn + 时间戳）。
4. 数据流出（Engage / 目的地同步）前校验：主体对目标厂商所属分类是否授权，未授权则拦截。

**流程 C · 删除/抑制请求 → 执行 → 审计**
1. 收到数据主体请求（API 或人工）→ 创建 `deletion_requests` 记录（type=删除/抑制，status=待处理）。
2. 执行器解析主体标识 → 经 id-mapping 解析 OneID → 收集关联身份。
3. **删除**：删/匿名化 `id_mapping`、`doris_user_wide`、`object_*` 的相关行，记录 `merge_log` 影响；**抑制**：写入 `suppression_list`。
4. 写抑制名单（防止后续重新采集复活），更新请求 status=已完成，落审计回执（操作人/范围/条数/时间）。

### 2.4 数据模型

> 隐私模块自身的 6 张表均**已建**（`sql/migrate_modules.sql`，`CREATE TABLE IF NOT EXISTS` + `utf8mb4_unicode_ci`，经 `scripts/apply_migrations.sh` 应用）。所有表含 `tenant_id`，全部查询按租户隔离。删除/抑制需覆盖的身份画像表为**现有表**（归属 id-mapping）。

**本模块已建表（真实 DDL 要点）**

**`pii_rules` —— PII 字段管控规则**（状态：**已建**）

| 列 | 类型 | 说明 |
|----|------|------|
| `rule_id` | BIGINT PK AUTO_INCREMENT | 主键 |
| `tenant_id` | BIGINT NOT NULL | 租户隔离 |
| `field_name` | VARCHAR(128) NOT NULL | 受管字段名 |
| `category` | VARCHAR(64) | PII 分类（如「电子邮箱」「身份证号」）|
| `action` | VARCHAR(32) | 处理动作 `mask/hash/drop/encrypt`（API 接受 hash/block/allow/mask/drop/encrypt）|
| `scope` | VARCHAR(64) | 生效范围 |
| `source` | VARCHAR(64) | 指定数据源 |
| `target_objects` | JSON | 生效对象列表（空=全部）|
| `created_by` | VARCHAR(128) | 创建人 |
| `created_at` / `updated_at` | DATETIME | 时间戳（updated_at ON UPDATE）|
| `is_active` | TINYINT DEFAULT 1 | 软删标记（0=禁用）|

键/索引：`UNIQUE uk_tenant_field(tenant_id, field_name)`、`INDEX idx_tenant(tenant_id)`、`INDEX idx_active(tenant_id, is_active)`。

**`consent_categories` —— 同意分类定义**（状态：**已建**）

| 列 | 类型 | 说明 |
|----|------|------|
| `category_id` | BIGINT PK AUTO_INCREMENT | 主键 |
| `tenant_id` | BIGINT NOT NULL | 租户隔离 |
| `category_name` | VARCHAR(128) NOT NULL | 分类名 |
| `description` | VARCHAR(512) | 描述 |
| `is_required` | TINYINT DEFAULT 0 | 是否必选 |
| `vendor_list` | JSON | 厂商/目的地映射列表 |
| `created_by` | VARCHAR(128) | 创建人 |
| `created_at` / `updated_at` | DATETIME | 时间戳 |

键/索引：`UNIQUE uk_tenant_cat(tenant_id, category_name)`、`INDEX idx_tenant(tenant_id)`。

**`consent_records` —— 主体级同意记录**（状态：**已建**）

| 列 | 类型 | 说明 |
|----|------|------|
| `record_id` | BIGINT PK AUTO_INCREMENT | 主键 |
| `tenant_id` | BIGINT NOT NULL | 租户隔离 |
| `one_id` | BIGINT | 主体 OneID |
| `identifier` | VARCHAR(256) | 标识符（前缀索引 64）|
| `category_id` | BIGINT NOT NULL | 关联同意分类 |
| `granted` | TINYINT DEFAULT 0 | 是否授权 |
| `withdrawn_at` | DATETIME | 撤回时间（未授权时落值）|
| `created_at` / `updated_at` | DATETIME | 时间戳 |

键/索引：`UNIQUE uk_tenant_one_category(tenant_id, one_id, category_id)`、`INDEX idx_tenant_one(tenant_id, one_id)`、`INDEX idx_category(tenant_id, category_id)`、`INDEX idx_identifier(tenant_id, identifier(64))`。

**`deletion_requests` —— GDPR 删除/抑制工单**（状态：**已建**）

| 列 | 类型 | 说明 |
|----|------|------|
| `request_id` | BIGINT PK AUTO_INCREMENT | 工单号 |
| `tenant_id` | BIGINT NOT NULL | 租户隔离 |
| `identifier` | VARCHAR(256) | 主体标识符 |
| `one_id` | BIGINT | 解析出的 OneID |
| `request_type` | VARCHAR(32) | `delete/suppress`（API 另支持 `both`）|
| `reason` | VARCHAR(512) | 请求事由 |
| `status` | VARCHAR(32) DEFAULT 'pending' | `pending/processing/completed/failed` |
| `created_by` | VARCHAR(128) | 受理人 |
| `affected_tables` | JSON | 执行回执：受影响表→条数 |
| `affected_count` | INT | 受影响总条数 |
| `executed_at` | DATETIME | 执行时间 |
| `created_at` / `updated_at` | DATETIME | 时间戳 |

键/索引：`INDEX idx_tenant(tenant_id)`、`INDEX idx_status(tenant_id, status)`、`INDEX idx_one_id(tenant_id, one_id)`。

**`suppression_list` —— 抑制名单**（状态：**已建**）

| 列 | 类型 | 说明 |
|----|------|------|
| `suppression_id` | BIGINT PK AUTO_INCREMENT | 主键 |
| `tenant_id` | BIGINT NOT NULL | 租户隔离 |
| `identifier` | VARCHAR(256) | 标识符（前缀索引 64）|
| `one_id` | BIGINT | OneID |
| `suppression_type` | VARCHAR(32) | `collect/forward/both` |
| `reason` | VARCHAR(512) | 事由 |
| `deletion_request_id` | BIGINT | 来源工单 |
| `created_at` | DATETIME | 入名单时间 |
| `expires_at` | DATETIME | 过期时间（NULL=永久；过期视为未抑制）|

键/索引：`UNIQUE uk_tenant_identifier(tenant_id, identifier(64))`、`INDEX idx_tenant(tenant_id)`、`INDEX idx_one_id(tenant_id, one_id)`、`INDEX idx_expires(tenant_id, expires_at)`。

**`privacy_audit_log` —— 隐私操作审计**（状态：**已建**）

| 列 | 类型 | 说明 |
|----|------|------|
| `audit_id` | BIGINT PK AUTO_INCREMENT | 主键 |
| `tenant_id` | BIGINT NOT NULL | 租户隔离 |
| `operation_type` | VARCHAR(32) | `delete/suppress/consent_change` |
| `deletion_request_id` | BIGINT | 关联工单 |
| `operator` | VARCHAR(128) | 操作人 |
| `one_id` | BIGINT | 主体 |
| `scope` | VARCHAR(64) | 操作范围描述 |
| `affected_records` | INT | 影响条数 |
| `detail` | JSON | 明细（如受影响表、request_type、granted）|
| `created_at` | DATETIME | 操作时间 |

键/索引：`INDEX idx_tenant(tenant_id)`、`INDEX idx_request(tenant_id, deletion_request_id)`、`INDEX idx_operation(tenant_id, operation_type, created_at)`。

**涉及的现有身份/画像表（归属 id-mapping，删除/抑制须覆盖）**

> 当前执行器（`privacy_api._DELETE_TARGETS`）真实清理下列表（表名为内部常量、绝不来自用户输入，WHERE 条件全部参数化按 `tenant_id`+`one_id` 命中）：

| 表 | 说明 | 删除时动作（已实现）|
|----|------|-----------|
| `id_mapping` | OneID ↔ 各身份标识映射（冷层）| `DELETE WHERE tenant_id AND one_id` |
| `doris_id_mapping` | 模拟 Doris 的映射表 | `DELETE WHERE tenant_id AND one_id` |
| `doris_user_wide` | 用户宽表/画像 | `DELETE WHERE tenant_id AND one_id` |
| `user_group_members` | 群组成员 | `DELETE WHERE tenant_id AND one_id` |
| `object_relations` | 对象关系 | `DELETE WHERE tenant_id AND (src/dst user=one_id)` |

> 说明：当前执行器为**硬删除骨架**，尚未联动 id-mapping 服务接口、未写 `merge_log` 留痕、未匿名化 `object_user` 等明细表（见 TODOs）。

## 2.5 逻辑设计（后端已落地）

> 实现文件：`services/sql-engine/privacy_api.py`（`PrivacyService` + `APIRouter`，prefix `/privacy`，已 `include_router` 进 `main.py`）。经网关访问前缀 `/api`（dev：Vite 代理；prod：nginx 同源）。全部走 `MysqlOlapExecutor` 取连接、参数化 SQL、按 `tenant_id` 隔离；圈人复用 `objects.ObjectService`，绝不手拼 SQL/不让 LLM 产 SQL。

### 2.5.1 端点列表（method / path / 请求 / 响应）

| 方法 | 路径 | 请求 | 响应 |
|------|------|------|------|
| POST | `/privacy/pii/scan` | body `PiiScanRequest`{tenant_id, scan_depth(all/object/source), object_type?, source?, limit=200} | {tenant_id, scan_depth, scanned_fields, detected_fields[]:{object,field,category,confidence,suggested_action,already_governed,existing_rule_id}} |
| GET | `/privacy/pii/rules` | query tenant_id, object_type? | {rules[]} |
| POST | `/privacy/pii/rules` | body `PiiRuleCreate`{tenant_id, field_name, category?, action(hash/block/allow/mask/drop/encrypt), scope?, source?, target_objects?[], created_by?} | {rule_id, created_at}（按 uk 去重 upsert）|
| PUT | `/privacy/pii/rules/{rule_id}` | query tenant_id + body `PiiRuleUpdate`{action?,scope?,category?,target_objects?,is_active?} | {updated_at}；404 规则不存在 |
| DELETE | `/privacy/pii/rules/{rule_id}` | query tenant_id, hard=false | {ok}（hard=false 软删 is_active=0，hard=true 物理删）|
| GET | `/privacy/consent/categories` | query tenant_id | {categories[]:含 optedIn_pct, vendors} |
| POST | `/privacy/consent/categories` | body `ConsentCategoryCreate`{tenant_id, category_name, description?, is_required, vendor_list?[], created_by?} | {category_id, created_at} |
| PUT | `/privacy/consent/categories/{category_id}` | query tenant_id + body `ConsentCategoryUpdate` | {updated_at}；404 |
| POST | `/privacy/consent` | body `ConsentRecordCreate`{tenant_id, one_id?, identifier?, category_id, granted} | {record_id, created_at}（upsert + 写审计 consent_change）|
| GET | `/privacy/consent/{one_id}` | query tenant_id | {one_id, records[]:{category_id,category_name,granted,granted_at,withdrawn_at}} |
| GET | `/privacy/deletion` | query tenant_id, status?, limit=50, offset=0 | {requests[], total} |
| POST | `/privacy/deletion` | body `DeletionRequestCreate`{tenant_id, identifier?, one_id?, request_type(delete/suppress/both), reason?, created_by?} | {request_id, status, created_at} |
| POST | `/privacy/deletion/{request_id}/execute` | query tenant_id + body{confirm} | {status, affected_tables, executed_at, audit_id}；400 未 confirm/已执行；404 |
| GET | `/privacy/deletion/{request_id}` | query tenant_id | 工单详情 + `audit_log[]`；404 |
| GET | `/privacy/suppression/check` | query tenant_id, identifier?, one_id? | {suppressed, reason?, suppression_type?, expires_at?}；400 二者皆空 |
| POST | `/privacy/audit/logs` | body `AuditLogQuery`{tenant_id, operation_type?, request_id?, start_date?, end_date?, limit=50, offset=0} | {logs[], total} |

### 2.5.2 核心算法 / 流程

- **PII 扫描（pii_scan）**：候选字段来自 `OBJECT_REGISTRY`（单一事实源）的各对象 `fields`，user 对象额外补扫宽表身份列 `_USER_IDENTITY_COLUMNS`（wechat_openid/unionid、wework_extid、phone、email、device、form_id）。对每个字段名做小写关键词匹配 `PII_DICTIONARY`（如 phone→电话号码 0.98 hash、id_card→身份证号 0.98 block），取置信度最高命中；与现有 `pii_rules` 比对标 `already_governed`，按 confidence 降序返回。**纯启发式建议，不读取/不改动任何真实数据值。**
- **同意授权率（list_consent_categories）**：分类表 LEFT 聚合 `consent_records`，按 `granted=1 AND withdrawn_at IS NULL` 计入分子，算出每分类 `optedIn_pct`。
- **OneID 解析（_resolve_one_id）**：工单若已带 one_id 直接用；否则用 identifier 先查 `id_mapping.channel_id`，未命中再查 `doris_user_wide` 的 phone/email。
- **删除/抑制执行器（execute_deletion）**：必须 `confirm=true`（不可逆，硬删）。流程：校验工单存在且非 completed → status=processing → 解析 OneID → `delete/both` 时遍历 `_DELETE_TARGETS` 参数化删除并累计每表 rowcount → `suppress/both` 时 upsert `suppression_list`（both→both，suppress→collect）→ 回写 status=completed + affected_tables(JSON) + affected_count + executed_at → 写 `privacy_audit_log` 回执。重复执行被拒。
- **抑制校验（suppression_check）**：按 identifier 或 one_id 取最新一条；命中但 `expires_at` 已过则视为未抑制（返回「已过期」）。
- **审计（_audit）**：删除、抑制、同意变更均落 `privacy_audit_log`，detail 存 JSON（受影响表/request_type/granted 等）。

### 2.5.3 与其他模块依赖

- **02-unify / id-mapping**：执行器直接读 `id_mapping`/`doris_user_wide` 解析 OneID 并删除身份画像表。**当前为同库直删骨架**，尚未走 id-mapping `:8001` 服务接口、未写 `merge_log` 留痕（见 TODOs）。
- **objects（多对象模型）**：PII 扫描以 `OBJECT_REGISTRY` 为字段来源；执行器清理 `object_relations`。
- **01-connections / ETL（待挂钩）**：`/privacy/suppression/check` 设计为供 `/etl/import`、`/events/process` 入口调用，命中即丢弃；`pii_rules` 的 hash/block 动作设计挂入库前置。**校验端点已就绪，入口侧尚未接入。**
- **05-engage（待挂钩）**：数据流出前应按 `consent_records` 做厂商级同意校验。
- **08-monitor**：审计回执可上报监控形成合规链。

## 3. 技术设计

### 3.1 前端（现有 Mock 页）

| 关注点 | 实现 |
|--------|------|
| 数据管控 | `DataControlsPage.tsx`：读 `piiFields`，`StatCards`（受管/自动检测/阻断/明文计数）+ `DataTable`（字段/类别/检测方式/处理动作/范围）|
| 同意管理 | `ConsentPage.tsx`：读 `consentCategories`，`StatCards`（分类数/必选/厂商总数/可选）+ `DataTable`（分类/是否必选/同意率/厂商数）|
| 删除与抑制 | `DeletionPage.tsx`：读 `deletionRequests`，`StatCards`（总数/处理中/已完成）+ `DataTable`（ID/主体/类型/时间/状态）+ 「新建删除请求」按钮（**当前无 onClick**）|
| Mock 数据 | `frontend/src/mock/data.ts`：`piiFields` / `consentCategories` / `deletionRequests` |
| 标注 | 三页 `actions` 均挂 `MockTag` |

### 3.2 后端（已落地，详见 2.5）

> 实现在 `services/sql-engine/privacy_api.py`（**注意：是 `privacy_api.py` 而非早期计划的 `privacy.py`**），表建于 MySQL `:3308`。6 张表已建、16 个端点已实现。端点清单与请求/响应见 §2.5.1，状态如下：

| 端点 | 方法 | 用途 | 状态 |
|------|------|------|------|
| `/privacy/pii/scan` | POST | 扫描 `OBJECT_REGISTRY` 字段 + user 身份列，启发式返回疑似 PII | **已建** |
| `/privacy/pii/rules` | GET/POST/PUT/DELETE | PII 规则 CRUD（写 `pii_rules`，upsert + 软删）| **已建** |
| `/privacy/consent/categories` | GET/POST/PUT | 同意分类 + 厂商映射 + 授权率统计 | **已建** |
| `/privacy/consent`、`/privacy/consent/{one_id}` | POST/GET | 同意采集/查询（写/读 `consent_records`）| **已建** |
| `/privacy/deletion`、`/privacy/deletion/{id}` | GET/POST | 删除/抑制工单 CRUD + 详情（写 `deletion_requests`）| **已建** |
| `/privacy/deletion/{id}/execute` | POST | **执行器**：删身份+画像 → 写抑制名单 → 落审计 | **已建（同库直删骨架）** |
| `/privacy/suppression/check` | GET | 抑制名单校验（供 ETL/事件入库调用）| **已建（入口侧未接入）** |
| `/privacy/audit/logs` | POST | 隐私操作审计查询 | **已建** |

### 3.3 真实 vs Mock 边界

- **当前真实（后端）**：6 张表 + 16 端点全部可用并经 pytest 验收（411P/0F/2S）。PII 规则/同意分类/同意记录/删除工单的增删改查、删除-抑制执行、抑制校验、审计查询均落真实 MySQL。
- **当前 Mock（前端）**：三页 `DataControlsPage`/`ConsentPage`/`DeletionPage` 仍渲染 `frontend/src/mock/data.ts` 静态数据，未发起网络请求；「新建删除请求」按钮仍无 onClick；三页 `MockTag` 未摘。
- **骨架/简化处**：PII 扫描为**字段名启发式**（不读真实值、不落库扫描结果）；删除执行器为**同库硬删骨架**，未走 id-mapping 服务接口、未写 `merge_log`、未匿名化 `object_user` 等明细；抑制校验端点就绪但 ETL/事件入口尚未挂钩；PII hash/block 动作未挂入库前置；Engage 流出侧同意校验未接。
- **接真路径**：三页 `DataTable` 数据源由 `mock/data.ts` 切到 `/api/privacy/*` → 「新建删除请求」接 POST + execute → 入口侧挂 suppression/check 钩子 → 摘 `MockTag`。
- **合规要点**：删除须**真删或不可逆匿名化**（非软删标记）；抑制名单须在「采集入口」和「流出出口」双侧生效，否则删除后会被重新采集复活。

### 3.4 依赖与集成

- **id-mapping（02-unify，强依赖）**：**当前执行器直接同库删除**身份/画像表（`id_mapping`/`doris_id_mapping`/`doris_user_wide`/`user_group_members`/`object_relations`）。后续应改为经 id-mapping `:8001` 的 `erase(one_id)` 接口或同事务删除，并在 `merge_log` 留痕。
- **ETL / 事件入库（01-connections）**：`suppression_list` 校验须挂在 **`/etl/import`** 与 **`/events/process`** 入口——命中抑制名单的 identifier 直接丢弃，不入任何对象表。
- **PII 管控（入库管线）**：`pii_rules` 的哈希/阻断/明文动作须在入库前置环节执行（同样挂在 ETL/事件处理路径）。
- **Engage / 目的地（05-engage）**：数据流出前按 `consent_records` 做厂商级同意校验，未授权拦截。
- **审计/监控（08-monitor）**：删除/抑制执行回执与异常应上报监控，形成合规可追溯链。

## 4. TODOs

**P0（让合规可执行 —— 删除与抑制闭环）**
- [x] [数据] 建 `deletion_requests` + `suppression_list` 两表（MySQL `:3308`）。
- [x] [后端] 新建 `services/sql-engine/privacy_api.py`：删除/抑制工单 CRUD + 执行器。
- [~] [后端] 删除执行器：已解析 OneID → 同库删 `id_mapping`/`doris_id_mapping`/`doris_user_wide`/`user_group_members`/`object_relations` → 写抑制名单 + 审计。**待办：改走 id-mapping 服务接口/同事务、写 `merge_log` 留痕、匿名化 `object_user` 等明细。**
- [~] [后端] 抑制校验 `/privacy/suppression/check` 端点已就绪；**待办：挂到 `/etl/import` 与 `/events/process` 入口。**
- [ ] [前端] `DeletionPage` 的「新建删除请求」接 POST；列表数据源切 `/api/privacy/deletion`，摘 `MockTag`。

**P1（PII 管控与同意接真）**
- [x] [数据] 建 `pii_rules` / `consent_categories` / `consent_records`（外加 `privacy_audit_log`）。
- [~] [后端] PII 规则 CRUD + 扫描端点已建（扫 `OBJECT_REGISTRY` 字段 + user 身份列）；**待办：哈希/阻断/明文动作挂入库前置。**
- [~] [后端] 同意采集/查询 API + 授权率统计已建；**待办：目的地流出前的厂商级同意校验（05-engage）。**
- [ ] [前端] `DataControlsPage` 改可编辑（按字段改动作/范围）；`ConsentPage` 分类+厂商映射可配置；数据源切 API。

**P2（打磨与可追溯）**
- [x] [后端] 删除/抑制/同意变更已落**审计回执**（`privacy_audit_log`，含操作类型/范围/条数/明细/时间）。
- [ ] [后端] 审计回执上报 08-monitor。
- [ ] [后端] 删除请求异步化（队列 + 进度回写 status），支持大主体批量。
- [ ] [前端] 删除请求详情页：展示受影响表/条数/回执（`GET /privacy/deletion/{id}` 已返回 affected_tables + audit_log）；导出合规报告。
- [ ] [数据] PII 扫描结果落库 + 定时重扫；规则版本化。
