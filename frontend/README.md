# CDP 圈人控制台（前端）

TailAdmin 风格的 React + Vite + Tailwind 前端，对接 `sql-engine`。

## 功能（Phase 1）

- **概览**：各对象规模卡片（实时取自 `/objects/search` count）。
- **统一筛选器**：多条件 / 多条线（AND·OR）+ 跨对象**链式多跳**关联 + **边条件**
  （`create_time` / `properties.<key>`），实时**预估人数** + **SQL 预览**。
- **自然语言圈人**：输入中文 → `/agent/segment/draft` → 回填筛选器 + 摘要 + 预估。
- **对象页**：用户 / 客户 / 商品 / 门店（接 `/objects/search`）、用户标签（`/tags`）、
  用户群组（`/segments`）。
- **订单 / 可视化 ETL**：前端原型（后端对象 / ETL 引擎待补）。

## 开发

```bash
cd frontend
npm install
npm run dev            # http://localhost:5173 （/api 代理到 sql-engine:8002）

# 指定后端地址
SQL_ENGINE_URL=http://localhost:8002 npm run dev
```

前置：`sql-engine` 已启动（`docker compose up -d sql-engine` + 迁移）。

## 构建 / 部署

```bash
npm run build          # 产物在 dist/
```

生产由 nginx 同源托管 `dist/`，并把 `/api/*` 反代到 `sql-engine`（去掉 `/api` 前缀）。

## 技术栈

React 18 · Vite 5 · TypeScript · TailwindCSS 3 · react-router 6 · axios · lucide-react

## 目录

```
src/
  api/        client.ts(接口) · types.ts(DSL 类型)
  lib/        objects.ts(对象配置 / 操作符)
  context/    TenantContext.tsx(租户切换)
  components/
    layout/   Sidebar · Header · Layout
    filter/   UnifiedFilter · RelationEditor(递归) · ConditionEditor
    ui.tsx    Card · Button · DataTable · Badge …
  pages/      Dashboard · FilterPage · EtlPage · ObjectListPage · Tags · Segments · Orders
```
