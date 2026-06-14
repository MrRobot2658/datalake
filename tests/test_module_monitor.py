"""08 · monitor 模块测试 —— 投递监控 / 指标聚合 / 告警 后端

对标 Twilio Segment 的 Monitor / Delivery Overview / Sources Debugger。
覆盖正向、边界与多租户隔离。

前置：docker compose up -d mysql redis sql-engine && bash scripts/apply_migrations.sh
约定（与既有模块测试一致）：
  - 服务不可达（连接失败）或 monitor 路由未部署（非 200）时整体 skip，绝不 fail。
  - 用独立测试租户 + 带唯一后缀的数据源/名称，避免污染演示租户 1001/1002，且可重跑。
  - 指标桶时间戳取“当前时刻附近”，确保落在 overview/evaluate 的时间窗口内。
  - 只读/只加，不触碰既有测试与演示数据。
"""

import uuid
from datetime import datetime, timedelta

import pytest
import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

API = "http://localhost:8002"
# 绕过本机 http_proxy，避免 localhost 被代理（与既有测试一致）
S = requests.Session()
S.trust_env = False
# 密集顺序请求下偶发 keep-alive 连接被服务端关闭，对连接级错误自动重试，保证稳定。
_retry = Retry(total=3, connect=3, read=3, backoff_factor=0.2,
               allowed_methods=None, status_forcelist=[])
S.mount("http://", HTTPAdapter(max_retries=_retry))

# 独立测试租户，远离演示租户 1001/1002
TENANT_A = 990801
TENANT_B = 990802

# 每次运行的唯一后缀，保证可重跑且互不串扰
RUN = uuid.uuid4().hex[:8]


def _monitor_ready() -> bool:
    """monitor 路由是否可用：连接失败或非 200（未部署）均视为不可用。"""
    try:
        r = S.get(f"{API}/monitor/overview", params={"tenant_id": TENANT_A}, timeout=5)
    except requests.RequestException:
        return False
    return r.status_code == 200


pytestmark = pytest.mark.skipif(
    not _monitor_ready(),
    reason="sql-engine monitor 模块未就绪（服务未启动或路由未部署）",
)


def get(path: str, **params):
    return S.get(f"{API}{path}", params=params, timeout=15)


def post(path: str, body: dict | None = None, **params):
    return S.post(f"{API}{path}", json=body or {}, params=params, timeout=15)


def put(path: str, body: dict, **params):
    return S.put(f"{API}{path}", json=body, params=params, timeout=15)


def delete(path: str, **params):
    return S.delete(f"{API}{path}", params=params, timeout=15)


def _recent_ts(minutes_ago: int = 2) -> str:
    """当前时刻附近的桶时间戳，确保落在默认/测试窗口内。"""
    return (datetime.now() - timedelta(minutes=minutes_ago)).strftime("%Y-%m-%d %H:%M:%S")


def _src() -> str:
    """唯一数据源名，隔离 metrics(PK 含 source) 与 sources/stats 聚合。"""
    return f"src_{RUN}_{uuid.uuid4().hex[:6]}"


def _seed_metric(tenant: int, source: str, *, ts: str | None = None,
                 events=100, success=80, failed=20, p95=120) -> dict:
    """写入一个分钟桶指标，返回落库行。"""
    r = post("/monitor/metrics", {
        "bucket_ts": ts or _recent_ts(), "source": source,
        "events_total": events, "success_count": success, "failed_count": failed,
        "latency_ms_p50": 40, "latency_ms_p95": p95, "latency_ms_p99": p95 + 50,
    }, tenant_id=tenant)
    assert r.status_code == 200, r.text
    return r.json()


def _make_rule(tenant: int, **overrides) -> dict:
    body = {
        "name": f"规则_{RUN}_{uuid.uuid4().hex[:6]}",
        "metric": "success_rate", "operator": "lt", "threshold": 90,
        "window_minutes": 30, "channel": "email", "severity": "medium",
        "channel_config": {"to": "ops@test.local"}, "enabled": True,
    }
    body.update(overrides)
    r = post("/monitor/alert-rules", body, tenant_id=tenant)
    assert r.status_code == 200, r.text
    return r.json()


# ════════════════════════════════════════════════════════════════════════
# 指标写入 / 时间序列 / 总览
# ════════════════════════════════════════════════════════════════════════

class TestMetrics:
    def test_upsert_returns_row(self):
        src = _src()
        row = _seed_metric(TENANT_A, src, events=10, success=8, failed=2)
        assert row["tenant_id"] == TENANT_A
        assert row["source"] == src
        assert row["events_total"] == 10
        assert row["success_count"] == 8
        assert row["failed_count"] == 2

    def test_upsert_accumulates_same_bucket(self):
        """同 (tenant, bucket_ts, source) 重复写入应在桶内累加（ON DUPLICATE KEY）。"""
        src = _src()
        ts = _recent_ts()
        _seed_metric(TENANT_A, src, ts=ts, events=10, success=7, failed=3)
        row = _seed_metric(TENANT_A, src, ts=ts, events=5, success=5, failed=0)
        assert row["events_total"] == 15
        assert row["success_count"] == 12
        assert row["failed_count"] == 3

    def test_list_metrics_filter_by_source(self):
        src = _src()
        _seed_metric(TENANT_A, src)
        r = get("/monitor/metrics", tenant_id=TENANT_A, source=src)
        assert r.status_code == 200
        rows = r.json()
        assert len(rows) >= 1
        assert all(x["source"] == src for x in rows)

    def test_list_metrics_ascending_by_bucket(self):
        """时间序列应按桶升序，供折线图。"""
        src = _src()
        _seed_metric(TENANT_A, src, ts=_recent_ts(10))
        _seed_metric(TENANT_A, src, ts=_recent_ts(5))
        rows = get("/monitor/metrics", tenant_id=TENANT_A, source=src).json()
        ts_list = [x["bucket_ts"] for x in rows]
        assert ts_list == sorted(ts_list)

    def test_overview_kpi_computed(self):
        """近窗口聚合：成功率/错误率/平均 p95 正确计算。"""
        src = _src()
        _seed_metric(TENANT_A, src, events=100, success=80, failed=20, p95=200)
        r = get("/monitor/overview", tenant_id=TENANT_A, source=src, window_minutes=30)
        assert r.status_code == 200
        ov = r.json()
        assert ov["events_total"] == 100
        assert ov["success_count"] == 80
        assert ov["failed_count"] == 20
        assert ov["success_rate"] == 80.0
        assert ov["error_rate"] == 20.0
        assert ov["avg_latency_p95"] == 200.0

    def test_overview_empty_window_nulls(self):
        """无数据的数据源：总数 0、比率为 None（不除零）。"""
        ov = get("/monitor/overview", tenant_id=TENANT_A, source=_src(),
                 window_minutes=30).json()
        assert ov["events_total"] == 0
        assert ov["success_rate"] is None
        assert ov["error_rate"] is None

    def test_overview_window_clamped(self):
        """window_minutes 越界（0）被夹紧为合法值，不报错。"""
        r = get("/monitor/overview", tenant_id=TENANT_A, window_minutes=0)
        assert r.status_code == 200
        assert r.json()["window_minutes"] >= 1

    def test_metrics_tenant_isolation(self):
        """A 写入的指标，B 的 overview / list 看不到。"""
        src = _src()
        _seed_metric(TENANT_A, src, events=50, success=50, failed=0)
        # B 的 overview 该源为空
        ov_b = get("/monitor/overview", tenant_id=TENANT_B, source=src,
                   window_minutes=30).json()
        assert ov_b["events_total"] == 0
        # B 的 metrics 列表查不到
        rows_b = get("/monitor/metrics", tenant_id=TENANT_B, source=src).json()
        assert rows_b == []


# ════════════════════════════════════════════════════════════════════════
# 数据源近况
# ════════════════════════════════════════════════════════════════════════

class TestSources:
    def test_sources_lists_with_success_rate(self):
        src = _src()
        _seed_metric(TENANT_A, src, events=100, success=90, failed=10)
        rows = get("/monitor/sources", tenant_id=TENANT_A).json()
        by_src = {x["source"]: x for x in rows}
        assert src in by_src
        assert by_src[src]["events_total"] >= 100
        assert by_src[src]["success_rate"] == 90.0

    def test_sources_tenant_isolation(self):
        src = _src()
        _seed_metric(TENANT_A, src, events=10, success=10, failed=0)
        rows_b = get("/monitor/sources", tenant_id=TENANT_B).json()
        assert src not in {x["source"] for x in rows_b}


# ════════════════════════════════════════════════════════════════════════
# 投递日志 + 分组统计
# ════════════════════════════════════════════════════════════════════════

class TestDeliveryLogs:
    def test_create_returns_row(self):
        src = _src()
        r = post("/monitor/delivery-logs", {
            "source": src, "event_name": "page_view", "destination": "数据仓库",
            "status": "success", "http_code": 200, "latency_ms": 35,
            "event_id": f"evt_{RUN}", "detail": {"k": "中文值"},
        }, tenant_id=TENANT_A)
        assert r.status_code == 200, r.text
        row = r.json()
        assert row["id"]
        assert row["source"] == src
        assert row["status"] == "success"
        # JSON detail 应被解析回 dict（中文不应乱码）
        assert row["detail"] == {"k": "中文值"}

    def test_list_filter_by_status_and_source(self):
        src = _src()
        post("/monitor/delivery-logs", {"source": src, "status": "success"}, tenant_id=TENANT_A)
        post("/monitor/delivery-logs", {"source": src, "status": "failed",
                                        "error_message": "超时"}, tenant_id=TENANT_A)
        # 仅 failed
        rows = get("/monitor/delivery-logs", tenant_id=TENANT_A, source=src,
                   status="failed").json()
        assert len(rows) >= 1
        assert all(x["status"] == "failed" and x["source"] == src for x in rows)

    def test_list_descending_by_ts(self):
        src = _src()
        post("/monitor/delivery-logs", {"source": src, "status": "success"}, tenant_id=TENANT_A)
        post("/monitor/delivery-logs", {"source": src, "status": "success"}, tenant_id=TENANT_A)
        rows = get("/monitor/delivery-logs", tenant_id=TENANT_A, source=src).json()
        ts_list = [x["ts"] for x in rows]
        assert ts_list == sorted(ts_list, reverse=True)

    def test_delivery_stats_group_by_status(self):
        src = _src()
        post("/monitor/delivery-logs", {"source": src, "status": "success",
                                        "latency_ms": 20}, tenant_id=TENANT_A)
        post("/monitor/delivery-logs", {"source": src, "status": "failed",
                                        "latency_ms": 60}, tenant_id=TENANT_A)
        r = get("/monitor/delivery-stats", tenant_id=TENANT_A, group_by="status",
                window_minutes=60)
        assert r.status_code == 200
        dims = {x["dimension"] for x in r.json()}
        assert {"success", "failed"} & dims

    def test_delivery_stats_group_by_source(self):
        src = _src()
        post("/monitor/delivery-logs", {"source": src, "status": "success"}, tenant_id=TENANT_A)
        rows = get("/monitor/delivery-stats", tenant_id=TENANT_A, group_by="source",
                   window_minutes=60).json()
        assert src in {x["dimension"] for x in rows}

    def test_delivery_stats_invalid_group_by_400(self):
        """非白名单分组维度 → 400（防 SQL 注入面）。"""
        r = get("/monitor/delivery-stats", tenant_id=TENANT_A, group_by="drop_table")
        assert r.status_code == 400

    def test_delivery_logs_tenant_isolation(self):
        src = _src()
        post("/monitor/delivery-logs", {"source": src, "status": "success"}, tenant_id=TENANT_A)
        rows_b = get("/monitor/delivery-logs", tenant_id=TENANT_B, source=src).json()
        assert rows_b == []


# ════════════════════════════════════════════════════════════════════════
# 告警规则 CRUD + 多租户隔离
# ════════════════════════════════════════════════════════════════════════

class TestAlertRules:
    def test_create_get_list(self):
        rule = _make_rule(TENANT_A)
        rid = rule["id"]
        assert rid
        assert rule["channel_config"] == {"to": "ops@test.local"}

        r = get(f"/monitor/alert-rules/{rid}", tenant_id=TENANT_A)
        assert r.status_code == 200
        assert r.json()["id"] == rid

        r = get("/monitor/alert-rules", tenant_id=TENANT_A)
        assert rid in {x["id"] for x in r.json()}

    def test_list_filter_enabled(self):
        on = _make_rule(TENANT_A, enabled=True)
        off = _make_rule(TENANT_A, enabled=False)
        ids = {x["id"] for x in get("/monitor/alert-rules", tenant_id=TENANT_A,
                                    enabled=True).json()}
        assert on["id"] in ids
        assert off["id"] not in ids

    def test_update_rule(self):
        rid = _make_rule(TENANT_A)["id"]
        r = put(f"/monitor/alert-rules/{rid}", {
            "threshold": 50, "severity": "high", "enabled": False,
            "channel_config": {"to": "new@test.local"},
        }, tenant_id=TENANT_A)
        assert r.status_code == 200
        upd = r.json()
        assert float(upd["threshold"]) == 50.0
        assert upd["severity"] == "high"
        assert upd["enabled"] == 0
        assert upd["channel_config"] == {"to": "new@test.local"}

    def test_update_empty_keeps_row(self):
        """空 body 更新返回当前行（无字段变更也不报错）。"""
        rule = _make_rule(TENANT_A)
        r = put(f"/monitor/alert-rules/{rule['id']}", {}, tenant_id=TENANT_A)
        assert r.status_code == 200
        assert r.json()["id"] == rule["id"]

    def test_delete_rule(self):
        rid = _make_rule(TENANT_A)["id"]
        r = delete(f"/monitor/alert-rules/{rid}", tenant_id=TENANT_A)
        assert r.status_code == 200
        assert r.json()["deleted"] is True
        assert get(f"/monitor/alert-rules/{rid}", tenant_id=TENANT_A).status_code == 404

    def test_get_missing_404(self):
        assert get("/monitor/alert-rules/99999999", tenant_id=TENANT_A).status_code == 404

    def test_update_missing_404(self):
        assert put("/monitor/alert-rules/99999999", {"threshold": 1},
                   tenant_id=TENANT_A).status_code == 404

    def test_delete_missing_404(self):
        assert delete("/monitor/alert-rules/99999999", tenant_id=TENANT_A).status_code == 404

    def test_rule_tenant_isolation(self):
        """A 的规则 B 不可见、不可读/改/删。"""
        rid = _make_rule(TENANT_A)["id"]
        assert rid not in {x["id"] for x in get("/monitor/alert-rules",
                                                tenant_id=TENANT_B).json()}
        assert get(f"/monitor/alert-rules/{rid}", tenant_id=TENANT_B).status_code == 404
        assert put(f"/monitor/alert-rules/{rid}", {"threshold": 1},
                   tenant_id=TENANT_B).status_code == 404
        assert delete(f"/monitor/alert-rules/{rid}", tenant_id=TENANT_B).status_code == 404
        # A 的规则仍在
        assert get(f"/monitor/alert-rules/{rid}", tenant_id=TENANT_A).status_code == 200


# ════════════════════════════════════════════════════════════════════════
# 告警触发记录 + 确认 / 解决 + 隔离
# ════════════════════════════════════════════════════════════════════════

class TestAlertEvents:
    def test_create_get_list_event(self):
        rid = _make_rule(TENANT_A)["id"]
        r = post("/monitor/alert-events", {
            "rule_id": rid, "metric_value": 42.5, "detail": {"note": "测试触发"},
        }, tenant_id=TENANT_A)
        assert r.status_code == 200, r.text
        ev = r.json()
        eid = ev["id"]
        assert ev["status"] == "triggered"
        assert ev["detail"] == {"note": "测试触发"}

        assert get(f"/monitor/alert-events/{eid}", tenant_id=TENANT_A).status_code == 200
        rows = get("/monitor/alert-events", tenant_id=TENANT_A, rule_id=rid).json()
        assert eid in {x["id"] for x in rows}
        # 列表 JOIN 出规则名/指标/级别
        joined = {x["id"]: x for x in rows}[eid]
        assert "rule_name" in joined and joined["metric"] == "success_rate"

    def test_create_event_bad_rule_404(self):
        r = post("/monitor/alert-events", {"rule_id": 99999999}, tenant_id=TENANT_A)
        assert r.status_code == 404

    def test_acknowledge_then_resolve(self):
        rid = _make_rule(TENANT_A)["id"]
        eid = post("/monitor/alert-events", {"rule_id": rid}, tenant_id=TENANT_A).json()["id"]

        r = post(f"/monitor/alert-events/{eid}/acknowledge",
                 {"acknowledged_by": "pytest"}, tenant_id=TENANT_A)
        assert r.status_code == 200
        ack = r.json()
        assert ack["status"] == "acknowledged"
        assert ack["acknowledged_by"] == "pytest"
        assert ack["acknowledged_at"] is not None

        r = post(f"/monitor/alert-events/{eid}/resolve", tenant_id=TENANT_A)
        assert r.status_code == 200
        res = r.json()
        assert res["status"] == "resolved"
        assert res["resolved_at"] is not None

    def test_list_filter_by_status(self):
        rid = _make_rule(TENANT_A)["id"]
        eid = post("/monitor/alert-events", {"rule_id": rid}, tenant_id=TENANT_A).json()["id"]
        post(f"/monitor/alert-events/{eid}/resolve", tenant_id=TENANT_A)
        rows = get("/monitor/alert-events", tenant_id=TENANT_A, rule_id=rid,
                   status="resolved").json()
        assert eid in {x["id"] for x in rows}
        assert all(x["status"] == "resolved" for x in rows)

    def test_get_missing_event_404(self):
        assert get("/monitor/alert-events/99999999", tenant_id=TENANT_A).status_code == 404

    def test_acknowledge_missing_404(self):
        r = post("/monitor/alert-events/99999999/acknowledge", {}, tenant_id=TENANT_A)
        assert r.status_code == 404

    def test_resolve_missing_404(self):
        assert post("/monitor/alert-events/99999999/resolve",
                    tenant_id=TENANT_A).status_code == 404

    def test_event_tenant_isolation(self):
        """A 的触发记录 B 不可见、不可确认/解决。"""
        rid = _make_rule(TENANT_A)["id"]
        eid = post("/monitor/alert-events", {"rule_id": rid}, tenant_id=TENANT_A).json()["id"]
        assert get(f"/monitor/alert-events/{eid}", tenant_id=TENANT_B).status_code == 404
        assert post(f"/monitor/alert-events/{eid}/acknowledge", {},
                    tenant_id=TENANT_B).status_code == 404
        assert post(f"/monitor/alert-events/{eid}/resolve",
                    tenant_id=TENANT_B).status_code == 404
        assert eid not in {x["id"] for x in get("/monitor/alert-events",
                                                tenant_id=TENANT_B).json()}


# ════════════════════════════════════════════════════════════════════════
# 规则评估（按当前指标判定是否越界并触发）
# ════════════════════════════════════════════════════════════════════════

class TestEvaluate:
    def test_breach_fires_event(self):
        """成功率 50% < 阈值 90 → 越界，落库一条触发记录。"""
        src = _src()
        _seed_metric(TENANT_A, src, events=100, success=50, failed=50)
        rid = _make_rule(TENANT_A, metric="success_rate", operator="lt", threshold=90,
                         scope="specific_source", scope_value=src, window_minutes=30)["id"]
        r = post(f"/monitor/alert-rules/{rid}/evaluate", tenant_id=TENANT_A)
        assert r.status_code == 200, r.text
        res = r.json()
        assert res["metric_value"] == 50.0
        assert res["breached"] is True
        assert res["fired_event"] is not None
        eid = res["fired_event"]["id"]
        assert get(f"/monitor/alert-events/{eid}", tenant_id=TENANT_A).status_code == 200

    def test_no_breach_no_event(self):
        """成功率 100% 不越界 → 不触发。"""
        src = _src()
        _seed_metric(TENANT_A, src, events=100, success=100, failed=0)
        rid = _make_rule(TENANT_A, metric="success_rate", operator="lt", threshold=90,
                         scope="specific_source", scope_value=src, window_minutes=30)["id"]
        res = post(f"/monitor/alert-rules/{rid}/evaluate", tenant_id=TENANT_A).json()
        assert res["metric_value"] == 100.0
        assert res["breached"] is False
        assert res["fired_event"] is None

    def test_evaluate_fire_false_no_event(self):
        """fire=False：即使越界也只返回判定，不落库。"""
        src = _src()
        _seed_metric(TENANT_A, src, events=100, success=10, failed=90)
        rid = _make_rule(TENANT_A, metric="error_rate", operator="gt", threshold=50,
                         scope="specific_source", scope_value=src, window_minutes=30)["id"]
        res = post(f"/monitor/alert-rules/{rid}/evaluate", tenant_id=TENANT_A,
                   fire=False).json()
        assert res["breached"] is True
        assert res["fired_event"] is None
        # 未落库：该规则下无触发记录
        assert get("/monitor/alert-events", tenant_id=TENANT_A, rule_id=rid).json() == []

    def test_evaluate_missing_rule_404(self):
        assert post("/monitor/alert-rules/99999999/evaluate",
                    tenant_id=TENANT_A).status_code == 404

    def test_evaluate_tenant_isolation(self):
        """B 不能评估 A 的规则（规则按租户隔离 → 404）。"""
        rid = _make_rule(TENANT_A)["id"]
        assert post(f"/monitor/alert-rules/{rid}/evaluate",
                    tenant_id=TENANT_B).status_code == 404
