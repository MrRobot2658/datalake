"""06 · protocols 模块测试 — 埋点计划 / 事件 schema / 数据质量违规 / 事件转换规则

对标 Twilio Segment 的 Protocols（Tracking Plans / Violations / Transformations）。
覆盖：正向 CRUD、边界(404 / 校验失败)、多租户隔离、事件载荷校验落库。

前置：docker compose up -d mysql redis sql-engine
      bash scripts/apply_migrations.sh   # 应用 migrate_modules.sql

服务不可达则整文件 skip（不 fail）。所有数据带 _UQ 唯一前缀，测试自带清理，互不污染。
"""

import os
import uuid

import pytest
import requests

# 优先走网关，回退直连 sql-engine；绕过本机代理避免 localhost 被劫持
GATEWAY = os.getenv("TEST_GATEWAY_BASE", "http://localhost:8080/api")
DIRECT = os.getenv("TEST_SQL_ENGINE_BASE", "http://localhost:8002")

S = requests.Session()
S.trust_env = False

# 两个独立租户用于隔离测试
TENANT_A = 90601
TENANT_B = 90602

# 每次运行唯一前缀，避免与历史/并发数据冲突
_UQ = uuid.uuid4().hex[:8]


def _pick_base() -> str | None:
    for base in (DIRECT, GATEWAY):
        try:
            r = S.get(f"{base}/health", timeout=3)
            if r.status_code == 200:
                return base
        except requests.RequestException:
            continue
    return None


API = _pick_base()

pytestmark = pytest.mark.skipif(
    API is None,
    reason="sql-engine / 网关未就绪，请先 docker compose up -d 并 apply_migrations",
)


# ──────────────────────────────────────────────────────────────────────
# 辅助
# ──────────────────────────────────────────────────────────────────────


def _q(tenant_id: int, **extra) -> dict:
    return {"tenant_id": tenant_id, **extra}


def _create_plan(tenant_id: int, name_suffix: str = "", **over) -> dict:
    body = {
        "name": f"测试计划-{_UQ}-{name_suffix or uuid.uuid4().hex[:4]}",
        "description": "pytest 自动创建",
        "sources": ["app", "小程序"],
        "enabled": True,
    }
    body.update(over)
    r = S.post(f"{API}/protocols/tracking-plans", params=_q(tenant_id), json=body, timeout=10)
    assert r.status_code == 200, r.text
    return r.json()


def _delete_plan(tenant_id: int, plan_id: int) -> None:
    S.delete(f"{API}/protocols/tracking-plans/{plan_id}", params=_q(tenant_id), timeout=10)


def _create_tf(tenant_id: int, **over) -> dict:
    body = {
        "name": f"转换-{_UQ}-{uuid.uuid4().hex[:4]}",
        "scope": "Order Completed",
        "type": "rename",
        "config": {"from": "rev", "to": "revenue"},
        "enabled": True,
        "description": "pytest",
    }
    body.update(over)
    r = S.post(f"{API}/protocols/transformations", params=_q(tenant_id), json=body, timeout=10)
    assert r.status_code == 200, r.text
    return r.json()


# ──────────────────────────────────────────────────────────────────────
# 埋点计划 Tracking Plans
# ──────────────────────────────────────────────────────────────────────


class TestTrackingPlanCRUD:
    def test_create_then_get(self):
        plan = _create_plan(TENANT_A, "crud")
        try:
            assert plan["id"] > 0
            assert plan["tenant_id"] == TENANT_A
            assert plan["sources"] == ["app", "小程序"]  # JSON 已反序列化
            assert plan["enabled"] in (1, True)

            r = S.get(
                f"{API}/protocols/tracking-plans/{plan['id']}",
                params=_q(TENANT_A), timeout=10,
            )
            assert r.status_code == 200
            assert r.json()["id"] == plan["id"]
        finally:
            _delete_plan(TENANT_A, plan["id"])

    def test_list_contains_created(self):
        plan = _create_plan(TENANT_A, "list")
        try:
            r = S.get(f"{API}/protocols/tracking-plans", params=_q(TENANT_A), timeout=10)
            assert r.status_code == 200
            ids = {p["id"] for p in r.json()}
            assert plan["id"] in ids
        finally:
            _delete_plan(TENANT_A, plan["id"])

    def test_update(self):
        plan = _create_plan(TENANT_A, "upd")
        try:
            r = S.put(
                f"{API}/protocols/tracking-plans/{plan['id']}",
                params=_q(TENANT_A),
                json={"description": "已更新", "enabled": False, "sources": ["web"]},
                timeout=10,
            )
            assert r.status_code == 200
            out = r.json()
            assert out["description"] == "已更新"
            assert out["enabled"] in (0, False)
            assert out["sources"] == ["web"]
            # name 未传，应保持不变
            assert out["name"] == plan["name"]
        finally:
            _delete_plan(TENANT_A, plan["id"])

    def test_delete(self):
        plan = _create_plan(TENANT_A, "del")
        r = S.delete(
            f"{API}/protocols/tracking-plans/{plan['id']}", params=_q(TENANT_A), timeout=10
        )
        assert r.status_code == 200
        assert r.json()["deleted"] is True
        # 再查应 404
        r2 = S.get(
            f"{API}/protocols/tracking-plans/{plan['id']}", params=_q(TENANT_A), timeout=10
        )
        assert r2.status_code == 404

    def test_get_missing_404(self):
        r = S.get(f"{API}/protocols/tracking-plans/999999999", params=_q(TENANT_A), timeout=10)
        assert r.status_code == 404

    def test_update_missing_404(self):
        r = S.put(
            f"{API}/protocols/tracking-plans/999999999",
            params=_q(TENANT_A), json={"name": "x"}, timeout=10,
        )
        assert r.status_code == 404

    def test_delete_missing_404(self):
        r = S.delete(
            f"{API}/protocols/tracking-plans/999999999", params=_q(TENANT_A), timeout=10
        )
        assert r.status_code == 404

    def test_create_requires_name(self):
        r = S.post(
            f"{API}/protocols/tracking-plans",
            params=_q(TENANT_A), json={"description": "无名"}, timeout=10,
        )
        assert r.status_code == 422  # name 为必填


# ──────────────────────────────────────────────────────────────────────
# 计划事件 Plan Events
# ──────────────────────────────────────────────────────────────────────


class TestPlanEvents:
    def test_event_crud_lifecycle(self):
        plan = _create_plan(TENANT_A, "ev")
        try:
            r = S.post(
                f"{API}/protocols/tracking-plans/{plan['id']}/events",
                params=_q(TENANT_A),
                json={
                    "event": "Order Completed",
                    "type": "track",
                    "properties_json": {"revenue": "number", "currency": "string"},
                    "required": ["revenue"],
                    "status": "approved",
                },
                timeout=10,
            )
            assert r.status_code == 200, r.text
            ev = r.json()
            assert ev["id"] > 0
            assert ev["plan_id"] == plan["id"]
            assert ev["properties_json"] == {"revenue": "number", "currency": "string"}
            assert ev["required"] == ["revenue"]

            # 列表
            r2 = S.get(
                f"{API}/protocols/tracking-plans/{plan['id']}/events",
                params=_q(TENANT_A), timeout=10,
            )
            assert r2.status_code == 200
            assert ev["id"] in {e["id"] for e in r2.json()}

            # 更新
            r3 = S.put(
                f"{API}/protocols/tracking-plans/events/{ev['id']}",
                params=_q(TENANT_A),
                json={"status": "draft", "required": ["revenue", "currency"]},
                timeout=10,
            )
            assert r3.status_code == 200
            assert r3.json()["status"] == "draft"
            assert r3.json()["required"] == ["revenue", "currency"]

            # 删除
            r4 = S.delete(
                f"{API}/protocols/tracking-plans/events/{ev['id']}",
                params=_q(TENANT_A), timeout=10,
            )
            assert r4.status_code == 200
            assert r4.json()["deleted"] is True
        finally:
            _delete_plan(TENANT_A, plan["id"])

    def test_create_event_unknown_plan_404(self):
        r = S.post(
            f"{API}/protocols/tracking-plans/999999999/events",
            params=_q(TENANT_A), json={"event": "X"}, timeout=10,
        )
        assert r.status_code == 404

    def test_update_event_missing_404(self):
        r = S.put(
            f"{API}/protocols/tracking-plans/events/999999999",
            params=_q(TENANT_A), json={"status": "approved"}, timeout=10,
        )
        assert r.status_code == 404

    def test_delete_event_missing_404(self):
        r = S.delete(
            f"{API}/protocols/tracking-plans/events/999999999",
            params=_q(TENANT_A), timeout=10,
        )
        assert r.status_code == 404

    def test_delete_plan_cascades_events(self):
        """删除计划应级联删除其事件。"""
        plan = _create_plan(TENANT_A, "casc")
        S.post(
            f"{API}/protocols/tracking-plans/{plan['id']}/events",
            params=_q(TENANT_A), json={"event": "Page Viewed"}, timeout=10,
        ).raise_for_status()
        _delete_plan(TENANT_A, plan["id"])
        # 计划已删，列事件应为空（不报错）
        r = S.get(
            f"{API}/protocols/tracking-plans/{plan['id']}/events",
            params=_q(TENANT_A), timeout=10,
        )
        assert r.status_code == 200
        assert r.json() == []


# ──────────────────────────────────────────────────────────────────────
# 事件载荷校验 Validate（含违规落库）
# ──────────────────────────────────────────────────────────────────────


class TestValidate:
    def _plan_with_schema(self) -> dict:
        plan = _create_plan(TENANT_A, "val")
        S.post(
            f"{API}/protocols/tracking-plans/{plan['id']}/events",
            params=_q(TENANT_A),
            json={
                "event": f"Checkout-{_UQ}",
                "properties_json": {"revenue": "number", "currency": "string"},
                "required": ["revenue"],
            },
            timeout=10,
        ).raise_for_status()
        return plan

    def test_valid_payload(self):
        plan = self._plan_with_schema()
        try:
            r = S.post(
                f"{API}/protocols/tracking-plans/{plan['id']}/validate",
                params=_q(TENANT_A),
                json={
                    "event": f"Checkout-{_UQ}",
                    "properties": {"revenue": 99.5, "currency": "CNY"},
                    "record_violation": False,
                },
                timeout=10,
            )
            assert r.status_code == 200
            out = r.json()
            assert out["valid"] is True
            assert out["issues"] == []
        finally:
            _delete_plan(TENANT_A, plan["id"])

    def test_missing_required_records_violation(self):
        plan = self._plan_with_schema()
        try:
            r = S.post(
                f"{API}/protocols/tracking-plans/{plan['id']}/validate",
                params=_q(TENANT_A),
                json={
                    "event": f"Checkout-{_UQ}",
                    "properties": {"currency": "CNY"},  # 缺 revenue
                    "source": f"src-{_UQ}",
                    "record_violation": True,
                },
                timeout=10,
            )
            assert r.status_code == 200
            out = r.json()
            assert out["valid"] is False
            assert any("必填" in i for i in out["issues"])
            assert len(out["recorded_violations"]) >= 1
            # 违规已落库，可经 source 过滤查回
            lr = S.get(
                f"{API}/protocols/violations",
                params=_q(TENANT_A, source=f"src-{_UQ}"), timeout=10,
            )
            assert lr.status_code == 200
            assert any(v["event"] == f"Checkout-{_UQ}" for v in lr.json())
        finally:
            # 清理落库违规
            for v in S.get(
                f"{API}/protocols/violations",
                params=_q(TENANT_A, source=f"src-{_UQ}"), timeout=10,
            ).json():
                S.delete(
                    f"{API}/protocols/violations/{v['id']}", params=_q(TENANT_A), timeout=10
                )
            _delete_plan(TENANT_A, plan["id"])

    def test_type_mismatch(self):
        plan = self._plan_with_schema()
        try:
            r = S.post(
                f"{API}/protocols/tracking-plans/{plan['id']}/validate",
                params=_q(TENANT_A),
                json={
                    "event": f"Checkout-{_UQ}",
                    "properties": {"revenue": "not-a-number"},  # 应为 number
                    "record_violation": False,
                },
                timeout=10,
            )
            assert r.status_code == 200
            out = r.json()
            assert out["valid"] is False
            assert any("类型不符" in i for i in out["issues"])
        finally:
            _delete_plan(TENANT_A, plan["id"])

    def test_unplanned_event(self):
        plan = self._plan_with_schema()
        try:
            r = S.post(
                f"{API}/protocols/tracking-plans/{plan['id']}/validate",
                params=_q(TENANT_A),
                json={
                    "event": f"Never-Defined-{_UQ}",
                    "properties": {},
                    "record_violation": False,
                },
                timeout=10,
            )
            assert r.status_code == 200
            out = r.json()
            assert out["valid"] is False
            assert any("未在埋点计划" in i for i in out["issues"])
        finally:
            _delete_plan(TENANT_A, plan["id"])

    def test_validate_unknown_plan_404(self):
        r = S.post(
            f"{API}/protocols/tracking-plans/999999999/validate",
            params=_q(TENANT_A), json={"event": "X", "properties": {}}, timeout=10,
        )
        assert r.status_code == 404


# ──────────────────────────────────────────────────────────────────────
# 违规 Violations
# ──────────────────────────────────────────────────────────────────────


class TestViolations:
    def test_record_and_aggregate(self):
        event = f"Bad Event {_UQ}"
        issue = f"缺少属性 foo {_UQ}"
        body = {"event": event, "issue": issue, "count": 1, "source": "app", "severity": "high"}
        vid = None
        try:
            r1 = S.post(f"{API}/protocols/violations", params=_q(TENANT_A), json=body, timeout=10)
            assert r1.status_code == 200
            v1 = r1.json()
            vid = v1["id"]
            assert v1["count"] == 1

            # 同 (event, issue) 再记一次应累加而非新建
            r2 = S.post(
                f"{API}/protocols/violations",
                params=_q(TENANT_A), json={**body, "count": 3}, timeout=10,
            )
            assert r2.status_code == 200
            v2 = r2.json()
            assert v2["id"] == vid  # 仍是同一行
            assert v2["count"] == 4  # 1 + 3
        finally:
            if vid:
                S.delete(f"{API}/protocols/violations/{vid}", params=_q(TENANT_A), timeout=10)

    def test_list_filter_by_severity(self):
        event = f"Sev Event {_UQ}"
        issue = f"高危问题 {_UQ}"
        r = S.post(
            f"{API}/protocols/violations",
            params=_q(TENANT_A),
            json={"event": event, "issue": issue, "severity": "high", "source": "web"},
            timeout=10,
        )
        vid = r.json()["id"]
        try:
            high = S.get(
                f"{API}/protocols/violations",
                params=_q(TENANT_A, severity="high"), timeout=10,
            ).json()
            assert any(v["id"] == vid for v in high)
            assert all(v["severity"] == "high" for v in high)
            low = S.get(
                f"{API}/protocols/violations",
                params=_q(TENANT_A, severity="low"), timeout=10,
            ).json()
            assert all(v["id"] != vid for v in low)
        finally:
            S.delete(f"{API}/protocols/violations/{vid}", params=_q(TENANT_A), timeout=10)

    def test_delete_violation(self):
        r = S.post(
            f"{API}/protocols/violations",
            params=_q(TENANT_A),
            json={"event": f"Tmp {_UQ}", "issue": f"待删 {_UQ}"},
            timeout=10,
        )
        vid = r.json()["id"]
        d = S.delete(f"{API}/protocols/violations/{vid}", params=_q(TENANT_A), timeout=10)
        assert d.status_code == 200
        assert d.json()["deleted"] is True

    def test_delete_missing_404(self):
        r = S.delete(f"{API}/protocols/violations/999999999", params=_q(TENANT_A), timeout=10)
        assert r.status_code == 404

    def test_record_requires_event_and_issue(self):
        r = S.post(
            f"{API}/protocols/violations", params=_q(TENANT_A), json={"event": "只有事件"}, timeout=10
        )
        assert r.status_code == 422  # issue 必填


# ──────────────────────────────────────────────────────────────────────
# 转换规则 Transformations
# ──────────────────────────────────────────────────────────────────────


class TestTransformations:
    def test_crud_lifecycle(self):
        tf = _create_tf(TENANT_A)
        try:
            assert tf["id"] > 0
            assert tf["config"] == {"from": "rev", "to": "revenue"}

            g = S.get(
                f"{API}/protocols/transformations/{tf['id']}", params=_q(TENANT_A), timeout=10
            )
            assert g.status_code == 200
            assert g.json()["id"] == tf["id"]

            u = S.put(
                f"{API}/protocols/transformations/{tf['id']}",
                params=_q(TENANT_A),
                json={"enabled": False, "config": {"from": "a", "to": "b"}},
                timeout=10,
            )
            assert u.status_code == 200
            assert u.json()["enabled"] in (0, False)
            assert u.json()["config"] == {"from": "a", "to": "b"}
        finally:
            S.delete(f"{API}/protocols/transformations/{tf['id']}", params=_q(TENANT_A), timeout=10)

    def test_list_filter_by_scope(self):
        scope = f"Scope-{_UQ}"
        tf = _create_tf(TENANT_A, scope=scope)
        try:
            r = S.get(
                f"{API}/protocols/transformations",
                params=_q(TENANT_A, scope=scope), timeout=10,
            )
            assert r.status_code == 200
            ids = {t["id"] for t in r.json()}
            assert tf["id"] in ids
            assert all(t["scope"] == scope for t in r.json())
        finally:
            S.delete(f"{API}/protocols/transformations/{tf['id']}", params=_q(TENANT_A), timeout=10)

    def test_delete(self):
        tf = _create_tf(TENANT_A)
        d = S.delete(
            f"{API}/protocols/transformations/{tf['id']}", params=_q(TENANT_A), timeout=10
        )
        assert d.status_code == 200
        assert d.json()["deleted"] is True
        g = S.get(
            f"{API}/protocols/transformations/{tf['id']}", params=_q(TENANT_A), timeout=10
        )
        assert g.status_code == 404

    def test_get_missing_404(self):
        r = S.get(f"{API}/protocols/transformations/999999999", params=_q(TENANT_A), timeout=10)
        assert r.status_code == 404

    def test_update_missing_404(self):
        r = S.put(
            f"{API}/protocols/transformations/999999999",
            params=_q(TENANT_A), json={"name": "x"}, timeout=10,
        )
        assert r.status_code == 404

    def test_delete_missing_404(self):
        r = S.delete(
            f"{API}/protocols/transformations/999999999", params=_q(TENANT_A), timeout=10
        )
        assert r.status_code == 404


# ──────────────────────────────────────────────────────────────────────
# 多租户隔离
# ──────────────────────────────────────────────────────────────────────


class TestTenantIsolation:
    def test_plan_isolation(self):
        """租户 A 的计划，租户 B 不可见 / 不可读 / 不可改删。"""
        plan = _create_plan(TENANT_A, "iso")
        try:
            # B 列表看不到
            lst = S.get(
                f"{API}/protocols/tracking-plans", params=_q(TENANT_B), timeout=10
            ).json()
            assert plan["id"] not in {p["id"] for p in lst}
            # B get 404
            assert S.get(
                f"{API}/protocols/tracking-plans/{plan['id']}",
                params=_q(TENANT_B), timeout=10,
            ).status_code == 404
            # B update 404
            assert S.put(
                f"{API}/protocols/tracking-plans/{plan['id']}",
                params=_q(TENANT_B), json={"name": "篡改"}, timeout=10,
            ).status_code == 404
            # B delete 404
            assert S.delete(
                f"{API}/protocols/tracking-plans/{plan['id']}",
                params=_q(TENANT_B), timeout=10,
            ).status_code == 404
            # A 仍然存在
            assert S.get(
                f"{API}/protocols/tracking-plans/{plan['id']}",
                params=_q(TENANT_A), timeout=10,
            ).status_code == 200
        finally:
            _delete_plan(TENANT_A, plan["id"])

    def test_event_isolation(self):
        """租户 A 计划下的事件，租户 B 不可改删。"""
        plan = _create_plan(TENANT_A, "evi")
        try:
            ev = S.post(
                f"{API}/protocols/tracking-plans/{plan['id']}/events",
                params=_q(TENANT_A), json={"event": f"Iso-{_UQ}"}, timeout=10,
            ).json()
            assert S.put(
                f"{API}/protocols/tracking-plans/events/{ev['id']}",
                params=_q(TENANT_B), json={"status": "approved"}, timeout=10,
            ).status_code == 404
            assert S.delete(
                f"{API}/protocols/tracking-plans/events/{ev['id']}",
                params=_q(TENANT_B), timeout=10,
            ).status_code == 404
        finally:
            _delete_plan(TENANT_A, plan["id"])

    def test_transformation_isolation(self):
        tf = _create_tf(TENANT_A)
        try:
            assert S.get(
                f"{API}/protocols/transformations/{tf['id']}",
                params=_q(TENANT_B), timeout=10,
            ).status_code == 404
            assert S.put(
                f"{API}/protocols/transformations/{tf['id']}",
                params=_q(TENANT_B), json={"name": "篡改"}, timeout=10,
            ).status_code == 404
            assert S.delete(
                f"{API}/protocols/transformations/{tf['id']}",
                params=_q(TENANT_B), timeout=10,
            ).status_code == 404
        finally:
            S.delete(f"{API}/protocols/transformations/{tf['id']}", params=_q(TENANT_A), timeout=10)

    def test_violation_isolation(self):
        event = f"Iso Viol {_UQ}"
        issue = f"隔离问题 {_UQ}"
        vid = S.post(
            f"{API}/protocols/violations",
            params=_q(TENANT_A), json={"event": event, "issue": issue}, timeout=10,
        ).json()["id"]
        try:
            # B 列表看不到 A 的违规
            b_list = S.get(f"{API}/protocols/violations", params=_q(TENANT_B), timeout=10).json()
            assert vid not in {v["id"] for v in b_list}
            # B 删不掉
            assert S.delete(
                f"{API}/protocols/violations/{vid}", params=_q(TENANT_B), timeout=10
            ).status_code == 404
        finally:
            S.delete(f"{API}/protocols/violations/{vid}", params=_q(TENANT_A), timeout=10)
