# 模块 01 · 连接 Connections

> 状态：CSV/Inline ETL 真实 + 连接配置层（Sources/Destinations/Reverse-ETL/Warehouses/Functions/Pipelines）已落库 CRUD（执行侧仍为模拟）· 对标 Segment Connections · 全局验收 411P/0F/2S

## 1. 概述

连接模块是 CDP 的「数据入口与出口」，对标 Segment 的 Connections（Sources / Destinations / Reverse ETL / Warehouses / Functions）。定位是「一次接入，导入任意对象（Track once, send everywhere）」：把外部数据源接进来，经字段映射与类型转换后落到统一对象表，并为下游激活、反向同步、落库、自定义转换提供框架。

当前**真实可跑的数据处理只有数据源侧的可视化 ETL**（CSV / 粘贴文本 → 字段映射 → 预览 → 导入到 `object_*` 表，并可选建立对象关系）。

本轮新增**连接配置层后端**：Sources / Destinations / Reverse-ETL / Warehouses / Functions / Pipelines 六大子域已落库（`connections_*` 表）并提供完整 CRUD 端点（`/connections/*`），含真实的 write_key 鉴权事件接收（`/connections/events/track` → `connections_source_events`）、目的地字段映射覆盖式保存、Reverse-ETL「立即运行」（复用 `ObjectService.search` 参数化统计源对象规模、落运行记录）等。**但「执行/投递/调度/沙箱」仍为模拟**：连接测试返回样例、目的地投递不实际外连、Reverse-ETL/Pipeline 仅记录 `pending` 状态、Warehouse sync 与 Function deploy 仅置状态标志。即 **「配置与元数据真实落库 + 执行侧模拟」**。MySQL / Kafka / REST API 等流式/拉取适配器的真实抽取仍**待建**。这条「真实 ETL 内核 + 配置层落库 + 执行侧模拟」的分层边界是本模块的核心特征。

## 2. 详细设计（产品）

### 2.1 子功能清单

| 功能 | 英文 | 状态 | 说明 |
|------|------|------|------|
| 数据源目录 | Sources Catalog | 真实(壳) | 列「已连接 CSV」+ 路线图 MySQL/Kafka/API；卡片点击进入 ETL |
| 可视化 ETL 导入 | Visual ETL | **真实** | CSV/Inline → 字段映射 → 预览(dry-run) → 导入对象 + 可选建关系（3 步向导）|
| 可视化编排画布 | Pipeline Canvas | Mock(交互真实) | 节点画布：左侧拖出节点、右侧 source→transform→destination 连线编排；前端交互真实，未接后端 |
| 自动字段匹配 | Auto Map | **真实(前端)** | 按列名同名/互相包含自动建议映射 |
| 数据源详情 | Source Detail | Mock | Schema 事件 / Write Key / 实时事件 Debugger（演示） |
| 目的地 | Destinations | Mock | 广告/营销/BI/Webhook 目录占位 |
| 反向 ETL | Reverse ETL | Mock | 数仓宽表按调度反向同步到目的地（任务列表） |
| 数据仓库 | Warehouses | Mock | Profiles/事件落库 OLAP/业务库（连接列表） |
| 自定义函数 | Functions | Mock | 数据源/目的地侧自定义代码转换（函数列表） |

### 2.2 信息架构与页面

| 路由 | 页面文件 | 说明 | 状态 |
|------|----------|------|------|
| `/connections` | `pages/ConnectionsPage.tsx` | 数据源目录：已连接 CSV + 路线图 MySQL/Kafka/API；右上「可视化编排」入口 | 真实(壳) |
| `/connections/flow` | `pages/EtlFlowPage.tsx` | 可视化编排画布：节点拖拽 + 连线（React Flow） | Mock(交互真实) |
| `/connections/sources/new` | `pages/EtlPage.tsx` | 可视化 ETL 导入（3 步：数据源→目标对象→字段映射） | **真实** |
| `/connections/sources/:id` | `pages/segment/SourceDetailPage.tsx` | 数据源详情：概览/Schema/Debugger 子页 | Mock |
| `/connections/destinations` | `pages/DestinationsPage.tsx` | 目的地目录（路线图卡片） | Mock |
| `/connections/reverse-etl` | `pages/segment/ReverseEtlPage.tsx` | 反向 ETL 任务列表 | Mock |
| `/connections/warehouses` | `pages/segment/WarehousesPage.tsx` | 数据仓库连接列表 | Mock |
| `/connections/functions` | `pages/segment/FunctionsPage.tsx` | Functions 列表 | Mock |

约定：真实页面在 `pages/`，Mock 页面在 `pages/segment/`，右上角统一打 `MockTag` 角标（见 [00-platform](./00-platform.md)）。

### 2.3 关键用户流程

**主流程（真实）：添加数据源 → 字段映射 → 预览 → 导入**

1. `/connections` 点「已连接 CSV」卡片或「添加数据源」→ 跳 `/connections/sources/new`（EtlPage）。
2. **步骤 1 数据源**：选数据源类型（仅 CSV/粘贴可选，mysql/kafka/api 置灰标「路线图」），在 textarea 粘贴含表头的 CSV；前端 `parseHeader` 实时解析首行表头为「源列」Badge。
3. **步骤 2 目标对象**：从 `OBJECTS`（kind=object）选导入目标（account/order/product/store）；目标字段来自 `getMetadata(tenant)` 返回的 `object.fields[].code`。
4. **步骤 3 字段映射**：进入或切目标时按「源列 ⟷ 目标字段」同名/互相包含规则 `autoMap()` 自动建议；可手动增删改、点「自动匹配」重算。
5. **预览（dry-run）**：点「预览」→ `etlPreview(body)` → `POST /etl/preview`，后端只解析+映射前 5 行，返回 `total_rows`/`preview`/`issues`（含缺主键、行级转换错误），不写库；前端用 `DataTable` 渲染并高亮 issues。
6. **导入**：点「导入」→ `etlImport(body)` → `POST /etl/import`，后端逐行 `upsert_object`，错误按行收集不中断；返回 `imported`/`relations`/`failed`/`errors`。前端显示统计卡 + 「去筛选 {对象}」跳 `/objects/:object`。
7. 若 `body` 带 `link`（导入时建关系），每行成功后按 `dst_id_source` 取值，写 `object_relations`。

**画布编排流程（交互真实、未接后端）：拖节点 → 连线 → 保存**

1. `/connections` 右上「可视化编排」或左栏「连接 → 可视化编排」→ 进 `/connections/flow`（EtlFlowPage），默认载入示例流程 `CSV → 字段映射 → 对象表`。
2. 左侧节点面板按 **数据源 / 转换 / 目的地** 三组列出可拖节点；拖到右侧画布即生成节点（`onDrop` + `screenToFlowPosition`）。
3. 拖连接把手连线：source 节点仅右出口、destination 仅左入口、transform 两端皆有 —— 从节点形态上约束 source→destination 方向。
4. 缩放/平移、MiniMap、Controls；选中节点按 Backspace 删除；工具条「示例流程 / 清空」。
5. 「保存流程」当前为 mock（角标「未接后端」）——尚未把画布拓扑序列化为可执行管道。

**Mock 流程**：Destinations/Reverse ETL/Warehouses/Functions/SourceDetail 均为只读展示，数据取自 `mock/data.ts`，无写入与调度。

### 2.4 数据模型

复用的既有对象层（导入目标）：

| 表/对象 | 字段(要点) | 状态 |
|---------|-----------|------|
| `object_account` | OneID/账户主键 + 注册表字段 | 已存在 |
| `object_order` | 订单主键 + 字段 | 已存在 |
| `object_product` | 商品主键 + 字段（id/sku/category/price…）| 已存在 |
| `object_store` | 门店主键 + 字段 | 已存在 |
| `object_relations` | (tenant_id, src_type, src_id, rel_type, dst_type, dst_id) | 已存在 |
| 对象注册表 | `OBJECT_REGISTRY`（id 主键字段 + fields 类型表）| 已存在(代码) |

本模块新建表（`sql/migrate_modules.sql`，均 `CREATE TABLE IF NOT EXISTS` + `ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`；所有表首列 `tenant_id BIGINT NOT NULL` 并入主键做多租户隔离）：

| 表 | 主键 / 唯一键 / 索引 | 关键列(要点) | 状态 |
|----|--------------------|-------------|------|
| `connections_sources` | PK `(tenant_id, source_id)`；UK `uk_write_key(tenant_id, write_key)`；IDX `idx_source_type(tenant_id, source_type)` | `source_id/source_name VARCHAR`，`source_type VARCHAR(64)`(csv/mysql/kafka/api/javascript)，`write_key VARCHAR(128)` 租户内唯一写入密钥，`config JSON`(连接配置)，`schema_def JSON`(推断字段类型，对外暴露为 `schema`)，`status`(active/paused/error)，`last_event_time DATETIME`，`event_count_24h INT`，`created_at/updated_at` | **已建** |
| `connections_source_events` | PK `(tenant_id, source_id, event_id)`；IDX `idx_recent(...,created_at)`、`idx_event_type(...,event_type)` | `event_id VARCHAR(64)`(uuid)，`event_type`，`event_timestamp DATETIME`，`anonymous_id/user_id VARCHAR(128)`，`data JSON`(事件负载)，`status`(success/error)，`error_msg VARCHAR(512)` | **已建** |
| `connections_destinations` | PK `(tenant_id, destination_id)`；IDX `idx_destination_type(...,destination_type)` | `destination_name`，`destination_type VARCHAR(64)`(ads/marketing/bi/webhook)，`config JSON`(api key/endpoint/credentials)，`enabled TINYINT` | **已建** |
| `connections_destination_mappings` | PK `(tenant_id, mapping_id)`；IDX `idx_destination(...,destination_id)` | `destination_id`，`source_object`(源对象/segment)，`target_field`(目的地 API 字段)，`source_field`(源字段/常量)，`transform_logic JSON` | **已建** |
| `connections_delivery_logs` | PK `(tenant_id, log_id)`；IDX `idx_destination(...,destination_id, created_at)` | `destination_id`，`batch_id`，`record_count/success_count/failed_count INT`，`status`(pending/success/partial/failed)，`error_msg`，`attempt_time DATETIME`，`response_time_ms INT` | **已建**(表就绪，投递引擎未写入) |
| `connections_reverse_etl_jobs` | PK `(tenant_id, job_id)`；IDX `idx_schedule(tenant_id, enabled, next_run_time)` | `job_name`，`source_object`(object_account/object_order/doris_user_wide)，`destination_id`，`schedule_cron VARCHAR(64)`，`enabled TINYINT`，`last_run_time/next_run_time DATETIME`，`last_status`(pending/success/failed)，`last_error_msg`，`total_synced_rows BIGINT` | **已建** |
| `connections_reverse_etl_runs` | PK `(tenant_id, run_id)`；IDX `idx_job(...,job_id, created_at)` | `job_id`，`start_time/end_time DATETIME`，`duration_ms INT`，`row_count INT`，`status`(success/failed/partial)，`error_msg` | **已建** |
| `connections_warehouses` | PK `(tenant_id, warehouse_id)`；IDX `idx_warehouse_type(...,warehouse_type)` | `warehouse_name`，`warehouse_type VARCHAR(32)`(doris/mysql/postgres/hive)，`connection_string/username/password VARCHAR`(注释「加密存储」)，`database_name`，`status`(healthy/error/not_connected)，`last_sync_time DATETIME`，`sync_frequency_seconds INT`，`tables_synced JSON` | **已建** |
| `connections_functions` | PK `(tenant_id, function_id)`；IDX `idx_function_type(...,function_type)` | `function_name`，`function_type`(source_function/destination_function)，`language`(javascript/python)，`code TEXT`(完整源码)，`runtime_version`，`status`(draft/deployed)，`entry_point`，`created_by` | **已建** |
| `connections_function_runs` | PK `(tenant_id, run_id)`；IDX `idx_function(...,function_id, created_at)` | `function_id`，`input/output JSON`，`status`(success/error)，`error_msg`，`duration_ms/memory_mb INT` | **已建**(表就绪，沙箱未写入) |
| `connections_pipelines` | PK `(tenant_id, pipeline_id)`；IDX `idx_status(tenant_id, status)` | `pipeline_name`，`nodes JSON`(节点数组 {id,type,position,config})，`edges JSON`(连线数组 {id,source,target})，`status`(draft/active/paused)，`last_executed_time DATETIME`，`execution_count INT`，`created_by` | **已建** |

## 3. 技术设计

### 3.1 前端

| 关注点 | 实现 |
|--------|------|
| 数据源目录 | `ConnectionsPage`：`SOURCES` 常量分 connected/catalog 两组卡片；均链到 `/connections/sources/new` |
| ETL 页面 | `EtlPage`：本地状态 `sourceType/csv/target/mapping/preview/result/busy/err`；用 `useTenant()` 取租户 |
| 元数据 | `getMetadata(tenant)` → `Metadata`，提供目标对象字段列表（`targetFields`）|
| 派生计算 | `parseHeader(csv)` 解析源列；`autoMap()` 同名/包含匹配建议映射 |
| 预览/导入 | `etlPreview(body)` / `etlImport(body)`，`body` = `{tenant_id, target_object, source:{type,csv}, mapping}` |
| 类型 | `EtlBody` / `EtlFieldMap`（`{target, source?, const?}`），`link` 可选建关系 |
| UI 组件 | `Card/Badge/Button/Spinner/DataTable`（`components/ui.tsx`）；步骤组件 `StepTitle`/`Stat` |
| Mock 页面 | `SourceDetailPage`/`ReverseEtlPage`/`WarehousesPage`/`FunctionsPage`/`DestinationsPage` 取 `mock/data.ts`，用 `kit.tsx` 的 `StatCards/Catalog/SubTabs/MockTag` |
| 编排画布 | `EtlFlowPage`：基于 `@xyflow/react`（React Flow v12）。`PALETTE`/`NODE_META` 定义节点；自定义节点 `EtlNode`（按 `kind` 裁剪 source/target 把手）；`useNodesState`/`useEdgesState` + `addEdge`；HTML5 拖拽落点经 `screenToFlowPosition` 换算。纯前端态，无持久化 |

api/client.ts 相关函数：`getMetadata`、`etlPreview`、`etlImport`。编排画布不调后端。

### 3.2 后端

| 服务/端点/表 | 说明 | 状态 |
|--------------|------|------|
| `POST /etl/preview` | dry-run，解析+映射前 N 行，返回 issues，不写库 | **已实现** |
| `POST /etl/import` | 逐行 upsert + 可选建关系，错误按行收集 | **已实现** |
| `POST /objects/upsert` | 对象 upsert（ETL 复用 `ObjectService.upsert_object`）| **已实现** |
| `GET /metadata/{tenant_id}/fields` | 返回对象字段元数据（前端目标字段来源）| **已实现** |
| `EtlService`（`services/sql-engine/etl.py`）| `read_rows`/`validate_mapping`/`map_record`/`_coerce`/`preview`/`run_import` | **已实现** |
| 源适配器 | `SOURCE_ADAPTERS={csv,inline}` 可运行；`ROADMAP_SOURCES={mysql,kafka,api}` 调用即报错 | csv/inline **已实现**；其余**待建** |
| 类型转换 | 按 `OBJECT_REGISTRY` 字段类型强转（int/float/json/json_array），空串→跳过 | **已实现** |
| 关系写入 | `link`：导入行主键 →(rel_type)→ dst，落 `object_relations` | **已实现** |
| `connections_api.py` 路由 | 独立 `APIRouter(prefix="/connections")`，`ConnectionsService` 复用 `MysqlOlapExecutor` + `ObjectService` | **已实现** |
| Sources CRUD + Write Key + 事件接收 | source 实例/凭据 CRUD、`/events/track` write_key 鉴权落库、`/sources/{id}/events` Debugger 数据源 | **已实现（元数据/事件真实，连接测试模拟）** |
| Destinations CRUD + 映射 | 目的地实例 CRUD、字段映射覆盖式保存、test 模拟 | **已实现（投递引擎仍待建）** |
| Reverse-ETL CRUD + run-now | 任务/运行记录 CRUD、立即运行复用 `ObjectService` 估算规模 | **已实现（调度器+真实搬运待建）** |
| Warehouses CRUD + sync | 连接 CRUD、sync 置状态/返回队列表 | **已实现（真实连接器待建）** |
| Functions CRUD + deploy + runs | 函数 CRUD、部署置状态、近 7 日运行聚合 | **已实现（沙箱运行时待建）** |
| Pipelines CRUD + execute | 画布拓扑(nodes/edges JSON)持久化、execute 置计数 | **已实现（真实编译执行待建）** |

后端链路：前端 `/api/*` →（dev vite 代理 / 生产 nginx :8080）→ SQL Engine `:8002` → MySQL `:3308`，按 `tenant_id` 隔离。

### 3.3 真实 vs Mock 边界

- **真实（数据处理）**：数据源目录壳、CSV/Inline ETL 全链路（预览/导入/类型转换/建关系）、自动字段匹配、导入后跳对象筛选。
- **真实（配置/元数据落库）**：`connections_*` 全表 CRUD（Sources/Destinations/映射/Reverse-ETL 任务+运行/Warehouses/Functions+运行/Pipelines），均按 `tenant_id` 隔离、参数化写入；write_key 生成与脱敏；`/events/track` 经 write_key 鉴权真实落库 + 计数更新；Reverse-ETL run-now 复用 `ObjectService` 真实统计源对象规模。
- **模拟（执行/投递/调度/沙箱）**：source/destination 连接测试返回固定样例与 latency；Destinations 不实际投递（`connections_delivery_logs` 表就绪未写入）；Reverse-ETL 仅记录 `pending`、无真实搬运与 cron 调度；Warehouse sync 仅置 `healthy`、Function deploy 仅置 `deployed`（`connections_function_runs` 未写入）、Pipeline execute 仅累加计数。
- **Mock（前端取 `mock/data.ts`，未接上述真实端点）**：当前 SourceDetail/Destinations/ReverseEtl/Warehouses/Functions 页面仍读 `mock/data.ts`，待接 `/connections/*`。
- **待建**：mysql/kafka/api 源（适配器位预留，调用报错，不假装支持）。
- **交互真实、未接后端**：可视化编排画布（拖拽/连线/缩放/删除全可用）；拓扑现可经 `/connections/pipelines` 持久化，但前端尚未接入、且执行仍为模拟。
- **关键约束**：路线图源 UI 可见但置灰；后端对 `mysql/kafka/api` 显式抛 `ObjectError`；执行侧端点统一返回 `pending`/模拟结果，避免「看起来支持实际不支持」。

### 3.4 依赖与集成

- 依赖 [00-platform](./00-platform.md)：`Layout`/`ui`/`kit`、`TenantContext`、API 客户端。
- 依赖对象层 `objects.py`（`ObjectService.upsert_object` / `add_relation`、`OBJECT_REGISTRY`）——导入即写统一对象表。
- 下游衔接 [02-unify](./02-unify.md)：导入后的对象进入统一筛选 `/objects/:object`；关系数据供 OneID/画像使用。
- 出口侧（Destinations/Reverse ETL）未来衔接 [05-engage](./05-engage.md) 的受众激活。

### 3.5 逻辑设计（连接配置层）

本轮新增的连接配置层不在 `main.py` 内联端点中，而是单独的 `services/sql-engine/connections_api.py`：自带 `APIRouter(prefix="/connections")`，在 `main.py` 中 `app.include_router(connections_router)` 挂载（line 499）。`ConnectionsService` 复用 `MysqlOlapExecutor().config` 取连接（`pymysql.connect(autocommit=True)`），并注入 `ObjectService` 用于源对象规模统计。所有写入均参数化 SQL，绝不字符串拼接；ID 由 `_nid(prefix)`=`{prefix}_{uuid4.hex[:16]}` 生成。

#### 端点列表（全部带 `tenant_id` query 强制隔离）

| Method | Path | 请求 | 响应(要点) |
|--------|------|------|-----------|
| GET | `/connections/sources` | `?tenant_id` | 数据源列表（`write_key` 经 `_mask` 脱敏） |
| POST | `/connections/sources` | `SourceCreate{source_name, source_type, config, schema(别名 schema_def)}` | `{source_id, write_key(明文,仅创建时返回), source_name}` |
| GET | `/connections/sources/{source_id}` | — | 源详情 + `recent_events`(近 20 条) |
| POST | `/connections/sources/{source_id}/test` | `TestConnectionRequest{config}` | `{ok, sample_rows}`（模拟，不实际外连） |
| GET | `/connections/sources/{source_id}/events` | `?limit(≤500)` | 事件流（`anonymousId/timestamp` 驼峰回写） |
| POST | `/connections/events/track` | `TrackRequest{write_key, events[]}` | `{ok, queued}`；**write_key 鉴权**，无效→401 |
| GET | `/connections/destinations` | — | 目的地列表 |
| POST | `/connections/destinations` | `DestinationCreate{destination_name, destination_type, config}` | `{destination_id, destination_name}` |
| GET | `/connections/destinations/{destination_id}` | — | 目的地 + 其字段映射 |
| POST | `/connections/destinations/{destination_id}/test` | `DestinationTestRequest{sample_data}` | `{ok, latency_ms}`（模拟） |
| POST | `/connections/destinations/{destination_id}/mappings` | `DestinationMappingRequest{source_object, mapping[]}` | `{ok}`；按 `source_object` **覆盖式**保存 |
| GET | `/connections/reverse-etl/jobs` | — | 任务列表 |
| POST | `/connections/reverse-etl/jobs` | `ReverseEtlJobCreate{job_name, source_object, destination_id, schedule_cron, enabled}` | `{job_id, job_name}` |
| GET | `/connections/reverse-etl/jobs/{job_id}/runs` | `?limit(≤200)` | 运行历史 |
| POST | `/connections/reverse-etl/jobs/{job_id}/run-now` | — | `{run_id, status:"pending"}`；落运行记录 |
| GET | `/connections/warehouses` | — | 数仓列表 |
| POST | `/connections/warehouses` | `WarehouseCreate{warehouse_name, warehouse_type, connection_string, username, password, database_name, sync_frequency_seconds}` | `{warehouse_id, status:"testing"}` |
| POST | `/connections/warehouses/{warehouse_id}/sync` | — | `{ok, queued_tables}`；置 `status='healthy'` |
| GET | `/connections/functions` | — | 函数列表 + 近 7 日 `runs_7d/errors_7d`(LEFT JOIN 聚合) |
| POST | `/connections/functions` | `FunctionCreate{function_name, function_type, language, code, entry_point}` | `{function_id, status:"draft"}` |
| POST | `/connections/functions/{function_id}/deploy` | — | `{ok, function_id}`；置 `status='deployed'`，未命中→404 |
| GET | `/connections/functions/{function_id}/runs` | `?limit(≤200)` | 执行历史 |
| GET | `/connections/pipelines` | — | 管道列表（仅返回 `node_count/edge_count`，不回传完整拓扑） |
| POST | `/connections/pipelines` | `PipelineCreate{pipeline_name, nodes[], edges[], status}` | `{pipeline_id, pipeline_name}` |
| GET | `/connections/pipelines/{pipeline_id}` | — | 完整拓扑（nodes/edges） |
| POST | `/connections/pipelines/{pipeline_id}/execute` | `PipelineExecuteRequest{source_config?, destination_config?}` | `{execution_id, status:"pending", estimated_duration_ms}` |

#### 核心算法 / 流程

- **Write Key 生命周期**：`create_source` 用 `secrets.token_urlsafe(24)` 生成 write_key，建唯一键 `uk_write_key(tenant_id, write_key)`；列表/详情经 `_mask` 仅显示首尾、明文只在创建响应返回一次。
- **事件接收（真实落库）**：`track` 先按 `(tenant_id, write_key)` 反查 `source_id`（失败→401），逐条 INSERT 进 `connections_source_events`，再 `UPDATE connections_sources SET last_event_time=NOW(), event_count_24h += queued`。这是本模块除 ETL 外唯一真实写入数据流的链路，供 SourceDetail Debugger 接真。
- **目的地映射覆盖式保存**：`save_mappings` 先校验目的地存在（→404），再 `DELETE ... WHERE source_object=?` 清旧、循环 INSERT 新映射，保证同一 (destination, source_object) 幂等。
- **Reverse-ETL 立即运行**：`run_reverse_etl_now` 取 `source_object`，经 `_safe_estimate` 复用 `ObjectService.search(count_only=True)` 参数化统计规模（非注册对象/异常则置 0，不抛错），插一条 `pending` run 并回写 job 的 `last_run_time/last_status`。**真实调度器与数据搬运未实现**。
- **JSON 字段归一**：`_normalize` 把 `_JSON_FIELDS`(config/schema_def/data/transform_logic/tables_synced/nodes/edges/input/output) 反序列化为对象，`schema_def` 对外暴露为 `schema`。
- **执行侧模拟边界**：test_source/test_destination 返回固定样例与 latency；sync_warehouse/deploy_function/execute_pipeline 仅更新状态/计数并返回 pending，不做真实外连、搬运或代码执行。

#### 与其他模块依赖

- 依赖 [00-platform](./00-platform.md)：`MysqlOlapExecutor`(连接配置)、router 挂载约定。
- 依赖对象层 `objects.py`：`ObjectService.search(count_only=True)` 供 Reverse-ETL 规模估算；`source_object` 取值对齐 `object_*` / `doris_user_wide`。
- 与既有 ETL 内核（`etl.py` + `/etl/*`）并存：ETL 负责「导入数据」，连接配置层负责「管理连接元数据」，二者共用对象表但端点独立。
- 出口侧（Destinations/Reverse-ETL）未来衔接 [05-engage](./05-engage.md) 受众激活与 `segment_destinations`。

## 4. TODOs

> 本轮完成：连接配置层 `connections_api.py` 全量落地（六大子域 `connections_*` 表 + CRUD 端点 + write_key 鉴权事件接收 + 目的地映射覆盖式保存 + Reverse-ETL run-now）。全局验收 411P/0F/2S。下列「✅」为本轮已落地、`[ ]` 为待办。

**P0（把数据源接真、补齐 ETL 健壮性）**
- [x] ✅ [后端] 新建 **Sources 注册表**（`connections_sources` + `write_key` 唯一键）及 `GET/POST /connections/sources`、详情/test/events 端点。
- [ ] [前端] `ConnectionsPage` 接 `GET /connections/sources` 真实列表（替换写死 `SOURCES`）。
- [ ] [后端] 实现 `mysql` 适配器：连接配置 + 表/SQL 抽取 → 复用 `EtlService` 映射链路（替换 `ROADMAP_SOURCES` 报错位）。
- [ ] [前端] EtlPage 暴露 `link`（建关系）配置 UI；目前 `EtlFieldMap`/后端已支持，前端未给入口。
- [x] ✅ [后端] 编排画布拓扑持久化：`connections_pipelines`(nodes/edges JSON) + `GET/POST /connections/pipelines`、`/execute`。
- [ ] [前后端] 画布接 `/connections/pipelines` 保存/读取；节点配置抽屉；单源单目的链路真实执行（复用 `EtlService`，替换 execute 模拟）。
- [ ] [数据] 为对象表补主键/唯一约束与导入幂等校验，确保 upsert 行为可预期。

**P1（事件流与出口侧落地）**
- [x] ✅ [后端] 实时事件接收端点 `POST /connections/events/track`（按 `write_key` 鉴权）+ 落 `connections_source_events`，`GET /sources/{id}/events` 供 Debugger。
- [x] ✅ [后端] **Destinations** 配置表 + `GET/POST /connections/destinations` + 字段映射覆盖式保存。
- [ ] [后端] **Destinations 投递引擎**：实际外连投递 + 写 `connections_delivery_logs`（当前 test 为模拟、未投递）。
- [x] ✅ [后端] **Reverse-ETL** 任务/运行表 + `GET/POST /reverse-etl/jobs`、runs、run-now（规模估算复用 `ObjectService`）。
- [ ] [后端] **Reverse-ETL 调度器**：cron 调度 + 真实反向同步搬运（当前 run-now 仅记 `pending`）。
- [ ] [前端] SourceDetail/Destinations/ReverseEtl 页面接真实 `/connections/*`（替换 `mock/data.ts`，当前子 Tab `to:"#"` 占位）。

**P2（数仓 / 函数 / 流式源）**
- [x] ✅ [后端] **Warehouses** 连接表 + `GET/POST /connections/warehouses` + `/sync`（置状态）。
- [ ] [后端] **Warehouse 连接器**：真实数仓连接 + 落库同步（当前 sync 仅置 `healthy`）。
- [x] ✅ [后端] **Functions** 定义/运行表 + `GET/POST /connections/functions`、deploy、runs（近 7 日聚合）。
- [ ] [后端] **Functions 运行时**：自定义代码沙箱真实执行 + 写 `connections_function_runs`（当前 deploy 仅置状态）。
- [ ] [前端] `WarehousesPage`/`FunctionsPage` 接真实接口（替换 `mock/data.ts`）。
- [ ] [后端] `kafka` / `api` 适配器：流式消费 / 定时拉取，接入 `EtlService`。
- [ ] [前端] ETL 导入大文件分片/进度与失败行重试；`DataTable` 预览分页。
