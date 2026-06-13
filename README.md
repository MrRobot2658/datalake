# 多租户实时 ID-Mapping 开发环境

基于 [方案文档](./docs/多租户实时ID-Mapping%20+%20画像水平伸缩方案.md) 搭建的本地 Docker Compose 开发环境。

**仓库**：https://github.com/MrRobot2658/datalake

> **生产设计文档**：[docs/design.md](./docs/design.md)（Kafka / Flink / MySQL / Doris 宽表）  
> **规模扩展对照**：[docs/scale-comparison.md](./docs/scale-comparison.md)（dev → 2亿）  
> **Flink Job 模板**：[docs/flink/](./docs/flink/README.md)  
> **MCP 调用链路**：[docs/MCP调用链路.md](./docs/MCP调用链路.md)（自然语言 → 链式多跳 / 边条件 DSL → SQL → Doris，含只读 MCP）

## 架构

目标架构（[CDP 优化方案 V3.0-06](./docs/CDP优化方案V3.0-06.pdf) · 图 1 · 数据链路层级，自上而下）。
本地 dev 环境用 ID-Mapping 服务 + MySQL 模拟 Flink/Doris；StreamPark / DolphinScheduler / Doris 为生产目标组件。

```
图 1 · 数据链路层级（接入 → Kafka → Flink → MySQL → Doris）

  ┌─ L1 · 接入层（数据入口）
  │    小程序 / 企微 / 表单 / App / 批量导入 API
  │    统一封装为 UserEvent(tenant_id + channel + link_keys + properties)
  ▼
  ┌─ L2 · Kafka 消息层（事件总线）
  │    tenant-{id}-events（大租户独立 Topic） · shared-tenant-events（微租户共享）
  │    按 tenant_id / channel_id 分区，保证同一用户事件有序
  ▼
  ┌─ L3 · Flink 实时计算层（StreamPark 管控）
  │    Job-1 ID-Mapping(OneID 识别 / merge) → Job-2 画像聚合 → Job-3 宽表打宽
  │    输出 enriched-events，并行写入下游存储
  ▼
  ┌─ L3+ · Redis 热层（旁路，< 5ms 点查）
  │    Flink Job-1 同步写入 channel → one_id 映射，供实时识别 / 热点查询
  ▼
  ┌─ L4 · MySQL 业务冷层（持久化 / 审计）
  │    one_id 发号器 · id_mapping 离线导入 · merge_log 合并审计 · 租户配置
  ▼
  └─ L5 · Doris OLAP 层（画像 / 圈选）
       id_mapping · user_profile · user_wide
       大租户独立库 + BE Tag，小租户共享库 tenant_id 分区

  ── 查询层（只读）──────────────────────────────────────────────
     SQL Engine + CDP Agent ← 业务应用 / MA / BI；模板查询 → Doris / Redis

  ── 调度管控层（K8s 部署）─────────────────────────────────────
     StreamPark：Flink 实时 Job 启停扩缩
     DolphinScheduler：离线导入 / 批标签 / 数据同步 / Doris 运维
```

## 组件

| 组件 | 端口 | 说明 |
|------|------|------|
| MySQL 8 | 3308 | 业务库：id_mapping / user_profile / merge_log |
| Redis 7 | 6381 | OneID 热缓存 |
| Kafka | 9094 | 多租户事件总线 |
| Kafka UI | 8083 | Topic 可视化 |
| **Nginx 网关** | **8080** | **首页 + CDP 控制台 + API 路由代理** |
| **CDP 控制台** | **8080/console/** | **多对象 / 统一筛选器 / 跨对象多条线 / 自然语言圈人 / 存为群组 / 可视化 ETL（React，见 [frontend/](./frontend/README.md)）** |
| ID-Mapping | 8001 | 实时合并服务 API |
| SQL Engine | 8002 | OLAP 查询层（模板 SQL + 参数拼装，与 Doris 解耦） |

网关路由（`http://localhost:8080`）：

| 路径 | 目标 |
|------|------|
| `/` | 首页（服务导航） |
| `/console/` | CDP 圈人控制台（React SPA；`/api/*` 反代到 SQL Engine） |
| `/ID-Mapping` | ID-Mapping Swagger → `/docs` |
| `/SQL Engine` | SQL Engine Swagger → `/docs` |
| `/nl-query` 等 | SQL Engine API 根路径直通（Swagger Try it out 兼容） |

## 快速开始

```bash
# 0. 克隆仓库
git clone git@github.com:MrRobot2658/datalake.git      # SSH
# 或 HTTPS: git clone https://github.com/MrRobot2658/datalake.git
cd datalake

# 1. 启动全部服务（默认 dev 规模）
docker compose up -d --build

# 或按数据量模拟服务器集群
bash scripts/scale-up.sh dev      # <1万
bash scripts/scale-up.sh large    # 1亿（多 Kafka/Redis 节点）
bash scripts/scale-up.sh xlarge   # 2亿

# 2. 等待服务就绪（约 30-60 秒）
docker compose ps

# 3. 运行多渠道合并模拟

# 方式A: 走完整 Kafka 链路（推荐，含租户 1001 + 1002）
bash scripts/simulate_kafka.sh

# 方式B: 直接调 API（跳过 Kafka）
bash scripts/simulate_via_api.sh

# 4. 查看合并结果
bash scripts/query_status.sh 1001
bash scripts/query_status.sh 1002
```

## 模拟场景

### 租户 1001（品牌A，Topic `tenant-1001-events`）

| 步骤 | 渠道 | 说明 |
|------|------|------|
| 1 | 微信小程序 openid | 匿名访问，创建新 OneID |
| 2 | 微信 unionid | 授权登录，关联 openid |
| 3 | 手机号 | 注册绑定，通过 unionid 合并 |
| 4 | 企微 external_userid | 添加好友，通过 phone 合并 |
| 5 | App 设备 ID | 通过 email + phone 合并 |
| 6 | 冲突 openid | 另一 openid 绑定同一手机，触发 merge |

### 租户 1002（品牌B，Topic `tenant-1002-events`）

| 步骤 | 渠道 | 说明 |
|------|------|------|
| 1 | 微信 openid | H5 页面访问，创建新 OneID |
| 2 | 手机号 | 短信登录，通过 openid 合并 |
| 3 | 邮箱 | 订阅通知，通过 phone 合并 |
| 4 | 设备 ID | App 活跃，通过 email 合并 |

## SQL Engine（OLAP 查询层）

```bash
# 查看可用查询模板
curl http://localhost:8002/templates

# 按 OneID 查画像宽表
curl -X POST http://localhost:8002/query/profile_by_one_id \
  -H "Content-Type: application/json" \
  -d '{"params": {"tenant_id": 1001, "one_id": 100001}}'

# 按手机号查画像
curl "http://localhost:8002/query/profile_by_phone?tenant_id=1001&phone=13800138001"

# 宽表联合映射查询
curl -X POST http://localhost:8002/query/wide_join_mapping \
  -d '{"params": {"tenant_id": 1001, "one_id": 100001}}'

# 自然语义查询（DeepSeek 意图识别 → 模板 SQL → 执行）
# 经网关（推荐）
curl -X POST http://localhost:8080/nl-query \
  -H "Content-Type: application/json" \
  -d '{"question": "查手机号13800138001的用户画像", "tenant_id": 1001}'

# 或直连 SQL Engine
curl -X POST http://localhost:8002/nl-query \
  -H "Content-Type: application/json" \
  -d '{"question": "查手机号13800138001的用户画像", "tenant_id": 1001}'

# 自然语言查分组
curl -X POST http://localhost:8002/nl-query \
  -d '{"question": "分组vip_high_value有哪些成员", "tenant_id": 1001}'

# 用户 + 分组
curl http://localhost:8002/users/1001/100001
curl http://localhost:8002/groups/1001
```

配置 DeepSeek：复制 `.env.example` → `.env`，填入 `DEEPSEEK_API_KEY`（已在 `.gitignore` 中忽略）。

切换真实 Doris：设置 `OLAP_BACKEND=doris OLAP_HOST=doris-fe OLAP_PORT=9030`。

## Swagger API 文档

推荐通过网关访问：

| 服务 | 网关（推荐） | 直连 |
|------|-------------|------|
| 首页 | http://localhost:8080/ | — |
| ID-Mapping | http://localhost:8080/ID-Mapping/docs | http://localhost:8001/docs |
| SQL Engine | http://localhost:8080/SQL%20Engine/docs | http://localhost:8002/docs |

```bash
bash scripts/generate_swagger.sh   # 导出 docs/swagger/*.openapi.json
```

## API 接口

```bash
# 健康检查
curl http://localhost:8001/health

# 查询渠道 → OneID
curl http://localhost:8001/mapping/1001/phone/13900001111

# 查询用户画像
curl http://localhost:8001/profile/1001/100002

# 查看合并日志
curl http://localhost:8001/merge-log/1001

# 手动发送事件（不走 Kafka）
curl -X POST http://localhost:8001/events/process \
  -H "Content-Type: application/json" \
  -d '{
    "tenant_id": 1002,
    "channel_type": "phone",
    "channel_id": "13800002222",
    "link_keys": {"email": "user@brand-b.com"},
    "properties": {"amount": 500}
  }'
```

## MySQL 连接

```
Host:     localhost:3308
Database: datalake
User:     datalake
Password: datalake123
```

核心表：

- `tenants` — 租户配置（大租户独立 Topic，小租户共享 Topic）
- `id_mapping` — 渠道 ID → OneID 映射
- `user_profile` — 用户画像
- `user_groups` / `user_group_members` — 用户分组（人群包）与成员
- `merge_log` — 合并操作日志

## 预置数据

租户 1001 已预置离线映射：

- `wechat_unionid: union_abc123` → OneID `100001`
- `wechat_openid: oXxx_offline_001` → OneID `100001`
- `phone: 13800138001` → OneID `100001`

## 停止与清理

```bash
docker compose down        # 停止
docker compose down -v     # 停止并清除数据卷
```
