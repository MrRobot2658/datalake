# 模块 11 · 应用 Apps

## 概述

**应用市场**：把数据底座接到 CRM / 广告 / 消息 / 分析等第三方业务系统。一级菜单。应用**目录**是前端静态注册表，**连接状态**按租户持久化（真实）。定位：作为数据「出口/激活」的应用层入口，与「连接 › 目的地 / Reverse ETL」互补 —— 目的地偏数据流，应用偏业务系统集成。

## 详细设计（产品）

- **按类别平铺**应用卡片，每张卡片可**连接 / 断开**，已连接显示「已连接」标。
- 默认收录：
  - **CRM**：Salesforce · HubSpot · 销售易
  - **广告**：广点通 · 巨量引擎 · 百度营销
  - **消息**：短信 · 邮件 · 企业微信 · 钉钉
  - **分析**：神策 · Google Analytics
- 搜索过滤；连接状态即时落库，切租户独立。

### 数据模型

- `installed_apps`：`tenant_id / app_key / status(active·inactive) / config(JSON) / created_at / updated_at`，主键 `(tenant_id, app_key)`。

## 技术设计

- **前端**：`lib/apps.ts`（静态应用目录：key/name/category/icon/desc + 分组）、`pages/AppsPage.tsx`（按类别平铺 + 连接/断开）、`api/apps.ts`。一级菜单「应用」。
- **后端**：`services/sql-engine/apps_api.py`（`AppsService`，前缀 `/apps`）。
  - 端点：`GET /apps`（列出已连接）、`POST /apps/{key}`（连接/改状态，可带 config）、`DELETE /apps/{key}`。
- **基础设施**：`sql/migrate_apps.sql`。
- 真实 vs Mock：**连接状态真实**（落 `installed_apps`）；各应用的**真实 OAuth/API 对接为占位**（路线图）。

## TODOs

- `[后端]` P1 每个应用的**连接配置表单 + 凭证管理**（OAuth / API Key），加密存 `config`。
- `[后端]` P1 把应用对接成真实 **Destination / Reverse ETL** 目标：字段映射 + 回传/同步任务（复用调度）。
- `[后端]` P2 连接健康检查、最近同步状态、错误告警（接「监控」）。
- `[前端]` P2 应用详情页（用量、映射、日志）；应用分类/搜索增强、推荐位。
