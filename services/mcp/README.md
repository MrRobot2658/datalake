# CDP MCP Server（stdio）

把 sql-engine 的多对象筛选 / DSL 校验 / 人数预估 / NL 圈人能力，封装为 Claude 可调用的**只读** MCP 工具（文档 Ch4.4 / CDP Agent Phase 1）。

## 工具

| 工具 | 作用 |
|------|------|
| `cdp_schema` | 对象/字段/关联矩阵（构造条件前先查） |
| `cdp_search` | 跨对象筛选，返回明细（≤3 跳） |
| `cdp_estimate` | 人数预估（dry-run COUNT） |
| `cdp_validate` | 校验候选 DSL（字段/操作符/关联/跳数） |
| `cdp_translate` | DSL → 业务可读中文摘要 |
| `cdp_nl_segment` | 自然语言 → 候选 DSL + 预估 / 澄清 |
| `cdp_list_segments` | 列出已保存 Segment |

只读：不写规则、不绕权限；保存仍走人工确认链路（`/agent/segment/confirm`）。

## 前置

```bash
# 1) 起依赖 + sql-engine
docker compose up -d mysql redis sql-engine
bash scripts/apply_migrations.sh
.venv/bin/python scripts/simulate_objects.py --leads 20   # 可选：造数

# 2) MCP 依赖（已装则跳过）
.venv/bin/pip install -r services/mcp/requirements.txt
```

## 接入 Claude

项目根 `.mcp.json` 已配置（stdio，指向 `.venv/bin/python services/mcp/server.py`）。
在本项目目录启动 Claude Code 即自动加载；首次会提示信任该项目 MCP。

验证：`claude mcp list` 应显示 `cdp`；或在对话里直接问
「上海、公司规模大于500、且关联用户带 VIP 标签的线索有多少？」

环境变量：`SQL_ENGINE_URL`（默认 `http://localhost:8002`）、`CDP_TENANT_ID`（默认 1001）、`MCP_LOG_DIR`（默认 `services/mcp/logs`）。

## `/cdp` 技能（推荐入口）

除了直接对话触发 MCP 工具，项目内置了一个 Claude Code 技能 **`services/mcp/skills/cdp/SKILL.md`**，把上述工具按工作流编排好。

- **底层就是这套 MCP 工具**——技能只提供流程编排（先 `cdp_schema`→`cdp_validate`→`cdp_estimate`→翻译确认→保存走人工确认链路），不另起脚本、不绕权限。
- **覆盖全部只读能力**：核心圈人闭环 + 平台/连接/统一/对象/客户/触达/协议/隐私/监控/设置十大模块的「意图→工具」对照表。
- **用法**：在本项目目录的 Claude Code 里输入 `/cdp`，或直接问「上海、公司规模大于500、且关联用户带 VIP 标签的线索有多少？」即自动命中。

> 前提：`cdp` MCP 已加载（`claude mcp list` 能看到）。改过 `.mcp.json` 后需重开 Claude Code，让 MCP 配置与技能一并生效。

## 查询日志

每次查询自动记录到 `services/mcp/logs/mcp_queries.log`（5MB×3 轮转，已 gitignore）。
每行一条 JSON：

| 字段 | 含义 |
|------|------|
| `endpoint` | 命中的 sql-engine 接口 |
| `request` | 请求体（DSL/参数） |
| `sql` | 数据库实际执行的 SQL（`estimate`/`search` 携带；无则 `null`） |
| `db_elapsed_ms` | ⑥ Doris/MySQL 执行耗时 |
| `mcp_roundtrip_ms` | **MCP 调用→返回**总耗时（含 HTTP + 编译 + 序列化） |

`mcp_roundtrip_ms - db_elapsed_ms` ≈ HTTP/编译/序列化开销。
日志走文件而非 stdout——stdio MCP 的 stdout 被 JSON-RPC 占用，不能 print。

完整链路说明见 `docs/MCP调用链路.md`。
