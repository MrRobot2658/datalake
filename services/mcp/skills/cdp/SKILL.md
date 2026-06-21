---
name: cdp
description: >-
  CDP 客户数据平台只读助手——自然语言圈人、跨对象筛选、人数预估、DSL 校验/翻译，
  以及平台/连接/统一/对象/客户/触达/协议/隐私/监控/设置十大模块的只读巡查。
  当用户要"圈一批人/估人数/查某对象/看投递监控/查租户配置/列旅程·群发·管道·告警"等
  CDP 相关问题时使用。底层调用已注册的 cdp_* MCP 工具，全程只读；保存 Segment 走人工确认链路。
---

# CDP 只读助手

把 sql-engine 的 CDP 能力按工作流编排。**所有动作都调用已注册的 `cdp_*` MCP 工具**（见 `.mcp.json` 的 `cdp` server）。本技能只读：不写规则、不绕权限。先确认 `claude mcp list` 里有 `cdp`；没有就提示用户在本项目目录重开 Claude Code 并信任该 MCP。

**租户**：默认 `tenant_id=1001`（MCP 的 `CDP_TENANT_ID`）。用户提到别的租户时，每个工具调用都显式传 `tenant_id`。

---

## 核心工作流：自然语言圈人（Segment）

这是最高频场景。**铁律：LLM 永远不直接产 SQL——候选必须先过 `cdp_validate` 才能展示或估算。** 标准链路：

1. **查字段** — 先 `cdp_schema` 拿对象类型/字段/关联矩阵。只用真实存在的字段与已定义的关联，跳数 ≤ 3。
2. **出候选** — 优先 `cdp_nl_segment(question)`：中文人群描述 → 候选 DSL + 解释 + 人数预估。
   - 若返回 `needs_clarification=true`，把澄清问题原样转给用户，等回答后再继续，**不要自行脑补取值**。
3. **校验** — 自己拼的 DSL 一律先过 `cdp_validate`（字段/操作符/关联/跳数），拿到 `{ok, errors}`。`ok=false` 就按 errors 修正后重试，绝不跳过。
4. **看规模** — `cdp_estimate` 做 dry-run COUNT。规模异常（0 或过大）时回头检查条件，向用户复述口径。
5. **翻译确认** — `cdp_translate` 把 DSL 转成业务可读中文摘要，连同人数一起给用户确认。
6. **要明细时** — 才用 `cdp_search`（返回命中行，`limit` 默认 50）。
7. **保存** — MCP **不提供**保存工具。需落库时明确告诉用户：保存走人工确认链路 `POST /agent/segment/confirm`（前端控制台操作），本技能不代写。
8. 查已存规则用 `cdp_list_segments`。

**conditions 格式**：`[{"field","op","value"}]`，op ∈ `eq/ne/gt/ge/lt/le/in/not_in/contains/between/like`。
**relations 格式**：`[{"rel_type","object","direction"?,"conditions"?,"edge_conditions"?,"relations"?}]`，可嵌套实现链式多跳（整棵树 ≤ 3 跳）；`edge_conditions` 作用在关系行上，字段限 `create_time` / `properties.<key>`。

> 例："上海、公司规模>500、且关联用户带 VIP 标签的线索有多少？"
> → `cdp_schema` 确认 lead 有 `city`/`company_size`、lead→user 有 `belongs_to`
> → `cdp_validate` object=lead, conditions=[{city eq 上海},{company_size gt 500}], relations=[{belongs_to user, conditions=[{tags contains vip}]}]
> → `cdp_estimate` 报人数 → `cdp_translate` 给中文摘要让用户确认。

---

## 只读巡查：按模块查能力

用户问"有哪些…/某个…的详情/最近的…"时，按下表选工具。**纯读**，写操作一律走各模块自己的人工确认链路。

### 00 平台 Platform
| 意图 | 工具 |
|---|---|
| 列租户（名称/tier/状态/scale/近 24h 事件量，支持 search/tier/status） | `cdp_tenants` |
| 某租户每域有效配置（基础/通道/容量/ID-Mapping/存储/隐私/集成/配额） | `cdp_tenant_config` |

### 01 连接 Connections
| 意图 | 工具 |
|---|---|
| 数据源（含 write_key） | `cdp_sources` |
| 目的地（投递目标+映射） | `cdp_destinations` |
| 可视化编排管道拓扑 | `cdp_pipelines` |
| 反向 ETL 任务 | `cdp_reverse_etl_jobs` |
| 数仓连接 | `cdp_warehouses` |
| 自定义函数 | `cdp_functions` |

### 02 统一 Unify
| 意图 | 工具 |
|---|---|
| 群组/人群包（static\|dynamic） | `cdp_groups` |
| 身份解析规则（merge 策略/优先级） | `cdp_identity_rules` |
| SQL 计算特征 | `cdp_sql_traits` |
| 预测模型定义 | `cdp_predictions` |
| 某对象实例挂的标签 | `cdp_object_tags` |

### 03 对象 Objects
| 意图 | 工具 |
|---|---|
| 对象模型全景（字段/主键/表+关系矩阵） | `cdp_object_model` |
| 单条记录字段明细 | `cdp_object_record` |
| 单条记录的一跳关联 | `cdp_object_record_relations` |

### 04 客户 Accounts
| 意图 | 工具 |
|---|---|
| 列客户主数据 | `cdp_accounts` |
| 客户详情+关联用户+聚合指标 | `cdp_account_detail` |

### 05 触达 Engage
| 意图 | 工具 |
|---|---|
| 旅程（多步自动化，可按 status） | `cdp_journeys` |
| 群发（一次性触达，可按 status） | `cdp_broadcasts` |

### 06 协议 Protocols
| 意图 | 工具 |
|---|---|
| 埋点计划 | `cdp_tracking_plans` |
| 埋点违规 | `cdp_violations` |
| 数据转换 | `cdp_transformations` |

### 07 隐私 Privacy
| 意图 | 工具 |
|---|---|
| PII 管控规则（字段→脱敏/哈希/加密/拦截） | `cdp_pii_rules` |
| 同意分类 | `cdp_consent_categories` |
| 删除/抑制工单 | `cdp_deletion_requests` |
| 某标识符是否在抑制名单 | `cdp_suppression_check` |

### 08 监控 Monitor
| 意图 | 工具 |
|---|---|
| 投递总览（近 N 分钟总数/成功率/失败/延迟） | `cdp_monitor_overview` |
| 投递指标时间序列 | `cdp_monitor_metrics` |
| 逐事件投递日志（success/failed/retry/skipped） | `cdp_delivery_logs` |
| 告警规则+最近告警事件 | `cdp_alerts` |

### 09 设置 Settings
| 意图 | 工具 |
|---|---|
| IAM 成员（用户+角色） | `cdp_iam_users` |
| IAM 角色与权限 | `cdp_iam_roles` |
| 审计日志 | `cdp_audit_logs` |

---

## 边界与习惯

- **只读**：以上工具都不写库。任何"保存/新建/修改/删除"都不在本技能范围——告诉用户对应的人工确认入口（圈人走 `/agent/segment/confirm`，其余走前端控制台各模块）。
- **不手拼 SQL**：圈人一律走 `cdp_validate`→`cdp_estimate` 路径，绝不让候选绕过校验。
- **跳数 ≤ 3**：relations 整棵树最多 3 跳，超了 `cdp_validate` 会报错。
- **租户隔离**：跨租户问题逐工具显式传 `tenant_id`，别混用默认值。
- **拿不准字段就先 `cdp_schema`/`cdp_object_model`**，不要凭记忆猜字段名。
