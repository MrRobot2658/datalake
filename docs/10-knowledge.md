# 模块 10 · 知识库 Knowledge Base

## 概述

云盘式**多模态文件存储**，并可把文件**关联到对象**（user/account/order…）。一级菜单，**真实存储**（文件真的落盘、可下载预览）。定位：作为数据底座之外的非结构化资料中枢，沉淀合同/素材/报告等多模态资料，并与 OneID/对象画像打通。

## 详细设计（产品）

- **上传**：单文件上传（multipart），可填虚拟目录（如 `/合同/2026`）、描述，并可选关联对象（对象类型 + 记录 ID）。按 MIME/扩展名**自动归类**为 document / image / audio / video / archive / other。
- **浏览**：左侧目录树（「全部」+ 各虚拟目录），右侧文件网格 —— 图片显示缩略图，其余按类型显示图标；显示名称、大小、目录、已关联对象 chip。
- **检索/筛选**：按文件名搜索 + 按类型筛选（全部/文档/图片/音频/视频/其他）。
- **详情**：图片内联预览、元数据（类型/大小/目录/时间/描述）、下载；**对象关联**增删；删除文件。
- **对象关联**：一个文件可关联到多个对象（类型 + 可选记录 ID）；可在「按对象过滤」下只看某对象的资料。

### 数据模型

- `kb_files`：`id / tenant_id / name / folder / mime_type / kind / size_bytes / storage_path / description / created_at`
- `kb_links`：`id / tenant_id / file_id / object_type / object_id(可空) / created_at`

## 技术设计

- **前端**：`pages/KnowledgeBasePage.tsx`（云盘界面）、`api/kb.ts`（上传/列出/详情/下载直链 `kbDownloadUrl`/删除/关联增删）。一级菜单 `lib/nav.ts` 的「知识库」。
- **后端**：`services/sql-engine/kb_api.py`（`KbService`，前缀 `/kb`）。
  - 端点：`POST /kb/files`（multipart 上传）、`GET /kb/files`（按目录/对象/关键词/类型过滤）、`GET /kb/folders`、`GET /kb/files/{id}`、`GET /kb/files/{id}/download`（FileResponse 流式）、`DELETE /kb/files/{id}`、`POST·DELETE /kb/files/{id}/links`。
  - 存储：文件字节落 `KB_STORAGE_DIR`（compose `kb_data` 卷，路径 `{tenant}/{file_id}{ext}`），元数据/关联落 MySQL。
- **基础设施**：`sql/migrate_kb.sql`；sql-engine 依赖加 `python-multipart`；nginx `/api` 放开 `client_max_body_size 200m`（大文件上传）。
- 真实 vs Mock：**全真实**（上传/下载/关联/删除均落库落盘）。

## TODOs

- `[后端]` `[数据]` P1 文件夹树（`parent_id` 层级），而非纯字符串目录；移动/重命名。
- `[后端]` P2 缩略图/预览生成（pdf 首页、视频封面）；秒传/去重（按内容 hash）。
- `[后端]` P2 接对象存储后端（S3/MinIO/OSS，复用连接器目录），大文件分片上传。
- `[后端]` `[数据]` P2 文本/文档**向量化 + 检索**，作为智能助手 RAG 知识源（NL 问答引用知识库）。
- `[前端]` P2 对象记录详情页内嵌「关联资料」区，双向打通。
