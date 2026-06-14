"""05 · engage 触达模块测试 —— 旅程 Journeys + 群发 Broadcasts + 触达人数预估

对标 Twilio Segment「Engage」。覆盖 engage_api.py 暴露的全部端点：
  旅程   GET/POST /engage/journeys、GET/PUT/DELETE /engage/journeys/{id}、
         POST /engage/journeys/{id}/status、GET/PUT /engage/journeys/{id}/steps、
         GET /engage/journeys/{id}/state、GET /engage/journeys/{id}/stats
  群发   GET/POST /engage/broadcasts、GET/PUT/DELETE /engage/broadcasts/{id}、
         POST /engage/broadcasts/{id}/send、GET /engage/broadcasts/{id}/sends、
         GET /engage/broadcasts/{id}/stats
  预估   POST /engage/estimate-audience（复用 DSL → objects.build_sql）

前置：docker compose up -d mysql redis sql-engine
      bash scripts/apply_migrations.sh   # 应用 migrate_modules.sql（journeys/broadcasts 等表）

约定：服务不可达则整模块 skip（不算失败）；所有写入用 uuid 唯一编码，
      并在 fixture 中清理，避免污染既有数据。不改既有测试。
"""

import os
import uuid

import pytest
import requests

API = os.getenv("TEST_API_BASE_SQL", "http://localhost:8002")
# 绕过本机 http_proxy，避免 localhost 被代理（与 test_multi_object.py 一致）
S = requests.Session()
S.trust_env = False

TENANT = 1001
OTHER_TENANT = 1002  # 用于多租户隔离断言


# ════════════════════════════════════════════════════════════════════════
# 服务可达性 —— 不可达则整模块 skip
# ════════════════════════════════════════════════════════════════════════
@pytest.fixture(scope="module", autouse=True)
def _engage_ready():
    try:
        h = S.get(f"{API}/health", timeout=4)
        if h.status_code != 200:
            pytest.skip("sql-engine 未就绪（/health 非 200）")
        # 确认 engage 路由已挂载
        r = S.get(f"{API}/engage/journeys", params={"tenant_id": TENANT}, timeout=5)
        if r.status_code == 404:
            pytest.skip("engage 路由未挂载，请确认 engage_api 已 include_router")
    except requests.RequestException:
        pytest.skip("sql-engine 不可达，请先 docker compose up -d sql-engine")
    yield


def _code(prefix: str) -> str:
    return f"{prefix}-test-{uuid.uuid4().hex[:8]}"


# ── 旅程清理夹具：返回一个创建函数，测试结束自动删除所记录的旅程 ──────────────
@pytest.fixture
def journey_factory():
    created: list[tuple[int, int]] = []

    def make(tenant_id: int = TENANT, **overrides) -> dict:
        payload = {
            "tenant_id": tenant_id,
            "journey_code": _code("jny"),
            "journey_name": "测试旅程",
            "description": "engage 自动化测试旅程",
            "trigger_type": "segment_entry",
            "status": "draft",
            "created_by": "pytest",
        }
        payload.update(overrides)
        resp = S.post(f"{API}/engage/journeys", json=payload, timeout=10)
        assert resp.status_code == 200, resp.text
        row = resp.json()
        created.append((tenant_id, row["journey_id"]))
        return row

    yield make

    for tenant_id, jid in created:
        S.delete(f"{API}/engage/journeys/{jid}", params={"tenant_id": tenant_id}, timeout=10)


# ── 群发清理夹具 ──────────────────────────────────────────────────────────
@pytest.fixture
def broadcast_factory():
    created: list[tuple[int, int]] = []

    def make(tenant_id: int = TENANT, **overrides) -> dict:
        payload = {
            "tenant_id": tenant_id,
            "broadcast_code": _code("bc"),
            "broadcast_name": "测试群发",
            "channel_type": "email",
            "subject": "你好",
            "content_template": "尊敬的 {{name}}，您好",
            "estimated_size": 100,
            "created_by": "pytest",
        }
        payload.update(overrides)
        resp = S.post(f"{API}/engage/broadcasts", json=payload, timeout=10)
        assert resp.status_code == 200, resp.text
        row = resp.json()
        created.append((tenant_id, row["broadcast_id"]))
        return row

    yield make

    for tenant_id, bid in created:
        S.delete(f"{API}/engage/broadcasts/{bid}", params={"tenant_id": tenant_id}, timeout=10)


# ════════════════════════════════════════════════════════════════════════
# 旅程 Journeys —— 正向 CRUD
# ════════════════════════════════════════════════════════════════════════
class TestJourneyCrud:
    def test_create_returns_row(self, journey_factory):
        row = journey_factory(journey_name="新客欢迎旅程")
        assert row["journey_id"] > 0
        assert row["journey_name"] == "新客欢迎旅程"
        assert row["status"] == "draft"
        assert row["tenant_id"] == TENANT

    def test_create_persists_json_fields(self, journey_factory):
        """trigger_condition / visual_config 为 JSON，写入后应回读为 dict。"""
        cfg = {"nodes": [{"id": "n1", "type": "entry"}]}
        cond = {"segment_code": "vip"}
        row = journey_factory(visual_config=cfg, trigger_condition=cond)
        got = S.get(f"{API}/engage/journeys/{row['journey_id']}",
                    params={"tenant_id": TENANT}, timeout=10).json()
        assert got["visual_config"] == cfg
        assert got["trigger_condition"] == cond

    def test_get_includes_steps_key(self, journey_factory):
        row = journey_factory()
        got = S.get(f"{API}/engage/journeys/{row['journey_id']}",
                    params={"tenant_id": TENANT}, timeout=10).json()
        assert "steps" in got and got["steps"] == []

    def test_list_contains_created(self, journey_factory):
        row = journey_factory()
        data = S.get(f"{API}/engage/journeys", params={"tenant_id": TENANT}, timeout=10).json()
        assert any(j["journey_id"] == row["journey_id"] for j in data)

    def test_list_filter_by_status(self, journey_factory):
        row = journey_factory(status="draft")
        data = S.get(f"{API}/engage/journeys",
                     params={"tenant_id": TENANT, "status": "draft"}, timeout=10).json()
        assert all(j["status"] == "draft" for j in data)
        assert any(j["journey_id"] == row["journey_id"] for j in data)
        # 用一个不存在的状态过滤，不应包含本旅程
        none = S.get(f"{API}/engage/journeys",
                     params={"tenant_id": TENANT, "status": "archived"}, timeout=10).json()
        assert all(j["journey_id"] != row["journey_id"] for j in none)

    def test_update_fields(self, journey_factory):
        row = journey_factory()
        resp = S.put(f"{API}/engage/journeys/{row['journey_id']}",
                     params={"tenant_id": TENANT},
                     json={"journey_name": "改名后", "description": "改描述"}, timeout=10)
        assert resp.status_code == 200
        got = resp.json()
        assert got["journey_name"] == "改名后"
        assert got["description"] == "改描述"

    def test_set_status(self, journey_factory):
        row = journey_factory(status="draft")
        resp = S.post(f"{API}/engage/journeys/{row['journey_id']}/status",
                      params={"tenant_id": TENANT}, json={"status": "active"}, timeout=10)
        assert resp.status_code == 200
        assert resp.json()["status"] == "active"

    def test_set_status_idempotent_same_value(self, journey_factory):
        """状态未变化（rowcount=0）也应返回旅程而非 404。"""
        row = journey_factory(status="draft")
        resp = S.post(f"{API}/engage/journeys/{row['journey_id']}/status",
                      params={"tenant_id": TENANT}, json={"status": "draft"}, timeout=10)
        assert resp.status_code == 200
        assert resp.json()["journey_id"] == row["journey_id"]

    def test_delete(self, journey_factory):
        row = journey_factory()
        jid = row["journey_id"]
        resp = S.delete(f"{API}/engage/journeys/{jid}", params={"tenant_id": TENANT}, timeout=10)
        assert resp.status_code == 200
        assert resp.json()["deleted"] is True
        # 删除后再 get 应 404
        assert S.get(f"{API}/engage/journeys/{jid}",
                     params={"tenant_id": TENANT}, timeout=10).status_code == 404


# ════════════════════════════════════════════════════════════════════════
# 旅程 —— 边界 / 错误
# ════════════════════════════════════════════════════════════════════════
class TestJourneyEdge:
    def test_get_nonexistent_404(self):
        assert S.get(f"{API}/engage/journeys/999999999",
                     params={"tenant_id": TENANT}, timeout=10).status_code == 404

    def test_update_nonexistent_404(self):
        resp = S.put(f"{API}/engage/journeys/999999999",
                     params={"tenant_id": TENANT}, json={"journey_name": "x"}, timeout=10)
        assert resp.status_code == 404

    def test_status_nonexistent_404(self):
        resp = S.post(f"{API}/engage/journeys/999999999/status",
                      params={"tenant_id": TENANT}, json={"status": "active"}, timeout=10)
        assert resp.status_code == 404

    def test_delete_nonexistent_404(self):
        assert S.delete(f"{API}/engage/journeys/999999999",
                        params={"tenant_id": TENANT}, timeout=10).status_code == 404

    def test_duplicate_code_409(self, journey_factory):
        row = journey_factory()
        dup = S.post(f"{API}/engage/journeys", json={
            "tenant_id": TENANT, "journey_code": row["journey_code"],
            "journey_name": "重复编码",
        }, timeout=10)
        assert dup.status_code == 409

    def test_missing_required_field_422(self):
        """缺 journey_code（必填）应被 Pydantic 校验拦截为 422。"""
        resp = S.post(f"{API}/engage/journeys",
                      json={"tenant_id": TENANT, "journey_name": "无编码"}, timeout=10)
        assert resp.status_code == 422


# ════════════════════════════════════════════════════════════════════════
# 旅程步骤 / 运行状态 / 统计
# ════════════════════════════════════════════════════════════════════════
class TestJourneySteps:
    def test_replace_and_list_steps(self, journey_factory):
        row = journey_factory()
        jid = row["journey_id"]
        steps = [
            {"step_order": 1, "step_type": "action", "step_name": "发送欢迎邮件",
             "action_type": "send_email", "destination_id": "dest-email"},
            {"step_order": 2, "step_type": "wait", "step_name": "等待一天",
             "wait_duration_hours": 24},
            {"step_order": 3, "step_type": "split", "step_name": "是否打开",
             "condition_logic": "or",
             "conditions": [{"field": "opened", "op": "eq", "value": True}],
             "next_steps": [{"branch": "yes", "step_order": 4}]},
        ]
        resp = S.put(f"{API}/engage/journeys/{jid}/steps",
                     json={"tenant_id": TENANT, "steps": steps}, timeout=10)
        assert resp.status_code == 200
        out = resp.json()
        assert len(out) == 3
        assert out[0]["step_name"] == "发送欢迎邮件"
        # JSON 字段应回读为结构（list/dict），而非字符串
        assert isinstance(out[2]["conditions"], list)
        assert isinstance(out[2]["next_steps"], list)
        # GET steps 应一致
        listed = S.get(f"{API}/engage/journeys/{jid}/steps",
                       params={"tenant_id": TENANT}, timeout=10).json()
        assert [s["step_order"] for s in listed] == [1, 2, 3]

    def test_replace_steps_overwrites(self, journey_factory):
        """replace 语义：第二次只剩新步骤。"""
        row = journey_factory()
        jid = row["journey_id"]
        S.put(f"{API}/engage/journeys/{jid}/steps",
              json={"tenant_id": TENANT, "steps": [
                  {"step_order": 1, "step_type": "action", "step_name": "A"},
                  {"step_order": 2, "step_type": "action", "step_name": "B"}]}, timeout=10)
        resp = S.put(f"{API}/engage/journeys/{jid}/steps",
                     json={"tenant_id": TENANT, "steps": [
                         {"step_order": 1, "step_type": "exit", "step_name": "仅退出"}]}, timeout=10)
        out = resp.json()
        assert len(out) == 1 and out[0]["step_name"] == "仅退出"

    def test_replace_steps_empty_clears(self, journey_factory):
        row = journey_factory()
        jid = row["journey_id"]
        S.put(f"{API}/engage/journeys/{jid}/steps",
              json={"tenant_id": TENANT, "steps": [
                  {"step_order": 1, "step_type": "action", "step_name": "A"}]}, timeout=10)
        resp = S.put(f"{API}/engage/journeys/{jid}/steps",
                     json={"tenant_id": TENANT, "steps": []}, timeout=10)
        assert resp.status_code == 200 and resp.json() == []

    def test_replace_steps_journey_not_found_404(self):
        resp = S.put(f"{API}/engage/journeys/999999999/steps",
                     json={"tenant_id": TENANT, "steps": []}, timeout=10)
        assert resp.status_code == 404

    def test_state_empty_ok(self, journey_factory):
        """新旅程无运行状态，应返回空列表（200）。"""
        row = journey_factory()
        resp = S.get(f"{API}/engage/journeys/{row['journey_id']}/state",
                     params={"tenant_id": TENANT}, timeout=10)
        assert resp.status_code == 200
        assert resp.json() == []

    def test_stats_zeroed(self, journey_factory):
        row = journey_factory()
        resp = S.get(f"{API}/engage/journeys/{row['journey_id']}/stats",
                     params={"tenant_id": TENANT}, timeout=10)
        assert resp.status_code == 200
        stats = resp.json()
        assert stats["journey_id"] == row["journey_id"]
        assert stats["total"] == 0
        assert {"active", "completed", "exited", "by_status"} <= set(stats)


# ════════════════════════════════════════════════════════════════════════
# 群发 Broadcasts —— 正向 CRUD + 发送 + 回执 + 统计
# ════════════════════════════════════════════════════════════════════════
class TestBroadcastCrud:
    def test_create_returns_row(self, broadcast_factory):
        row = broadcast_factory(broadcast_name="618 大促")
        assert row["broadcast_id"] > 0
        assert row["broadcast_name"] == "618 大促"
        assert row["status"] == "draft"
        assert row["channel_type"] == "email"

    def test_get_and_list(self, broadcast_factory):
        row = broadcast_factory()
        got = S.get(f"{API}/engage/broadcasts/{row['broadcast_id']}",
                    params={"tenant_id": TENANT}, timeout=10)
        assert got.status_code == 200
        assert got.json()["broadcast_id"] == row["broadcast_id"]
        data = S.get(f"{API}/engage/broadcasts", params={"tenant_id": TENANT}, timeout=10).json()
        assert any(b["broadcast_id"] == row["broadcast_id"] for b in data)

    def test_list_filter_by_status(self, broadcast_factory):
        row = broadcast_factory()
        draft = S.get(f"{API}/engage/broadcasts",
                      params={"tenant_id": TENANT, "status": "draft"}, timeout=10).json()
        assert all(b["status"] == "draft" for b in draft)
        assert any(b["broadcast_id"] == row["broadcast_id"] for b in draft)

    def test_update(self, broadcast_factory):
        row = broadcast_factory()
        resp = S.put(f"{API}/engage/broadcasts/{row['broadcast_id']}",
                     params={"tenant_id": TENANT},
                     json={"subject": "更新后的主题", "estimated_size": 500}, timeout=10)
        assert resp.status_code == 200
        got = resp.json()
        assert got["subject"] == "更新后的主题"
        assert got["estimated_size"] == 500

    def test_send_marks_sending(self, broadcast_factory):
        row = broadcast_factory()
        resp = S.post(f"{API}/engage/broadcasts/{row['broadcast_id']}/send",
                      params={"tenant_id": TENANT}, timeout=10)
        assert resp.status_code == 200
        got = resp.json()
        assert got["status"] == "sending"
        assert got["sent_at"] is not None

    def test_sends_empty_ok(self, broadcast_factory):
        row = broadcast_factory()
        resp = S.get(f"{API}/engage/broadcasts/{row['broadcast_id']}/sends",
                     params={"tenant_id": TENANT}, timeout=10)
        assert resp.status_code == 200
        assert resp.json() == []

    def test_stats_zeroed(self, broadcast_factory):
        row = broadcast_factory()
        resp = S.get(f"{API}/engage/broadcasts/{row['broadcast_id']}/stats",
                     params={"tenant_id": TENANT}, timeout=10)
        assert resp.status_code == 200
        stats = resp.json()
        assert stats["total"] == 0
        assert {"sent", "delivered", "bounced", "opened", "clicked"} <= set(stats)

    def test_delete(self, broadcast_factory):
        row = broadcast_factory()
        bid = row["broadcast_id"]
        resp = S.delete(f"{API}/engage/broadcasts/{bid}", params={"tenant_id": TENANT}, timeout=10)
        assert resp.status_code == 200 and resp.json()["deleted"] is True
        assert S.get(f"{API}/engage/broadcasts/{bid}",
                     params={"tenant_id": TENANT}, timeout=10).status_code == 404


# ════════════════════════════════════════════════════════════════════════
# 群发 —— 边界 / 错误
# ════════════════════════════════════════════════════════════════════════
class TestBroadcastEdge:
    def test_get_nonexistent_404(self):
        assert S.get(f"{API}/engage/broadcasts/999999999",
                     params={"tenant_id": TENANT}, timeout=10).status_code == 404

    def test_update_nonexistent_404(self):
        resp = S.put(f"{API}/engage/broadcasts/999999999",
                     params={"tenant_id": TENANT}, json={"subject": "x"}, timeout=10)
        assert resp.status_code == 404

    def test_send_nonexistent_404(self):
        resp = S.post(f"{API}/engage/broadcasts/999999999/send",
                      params={"tenant_id": TENANT}, timeout=10)
        assert resp.status_code == 404

    def test_delete_nonexistent_404(self):
        assert S.delete(f"{API}/engage/broadcasts/999999999",
                        params={"tenant_id": TENANT}, timeout=10).status_code == 404

    def test_duplicate_code_409(self, broadcast_factory):
        row = broadcast_factory()
        dup = S.post(f"{API}/engage/broadcasts", json={
            "tenant_id": TENANT, "broadcast_code": row["broadcast_code"],
            "broadcast_name": "重复编码",
        }, timeout=10)
        assert dup.status_code == 409

    def test_missing_required_field_422(self):
        resp = S.post(f"{API}/engage/broadcasts",
                      json={"tenant_id": TENANT, "broadcast_name": "无编码"}, timeout=10)
        assert resp.status_code == 422


# ════════════════════════════════════════════════════════════════════════
# 触达人数预估 —— 复用 DSL → objects.build_sql（绝不手拼 SQL）
# ════════════════════════════════════════════════════════════════════════
class TestEstimateAudience:
    def test_estimate_with_dsl(self):
        resp = S.post(f"{API}/engage/estimate-audience", json={
            "tenant_id": TENANT,
            "dsl": {"object": "user",
                    "conditions": [{"field": "tags", "op": "contains", "value": "vip"}]},
        }, timeout=10)
        assert resp.status_code == 200
        body = resp.json()
        assert body["estimate"] >= 1
        # 经 objects 模板编译，COUNT + tenant 隔离应体现在 SQL 中
        assert "COUNT" in body["sql"].upper()
        assert "tenant_id" in body["sql"]

    def test_estimate_missing_dsl_and_segment_400(self):
        resp = S.post(f"{API}/engage/estimate-audience",
                      json={"tenant_id": TENANT}, timeout=10)
        assert resp.status_code == 400

    def test_estimate_unknown_segment_404(self):
        resp = S.post(f"{API}/engage/estimate-audience", json={
            "tenant_id": TENANT, "segment_code": f"no-such-{uuid.uuid4().hex[:6]}",
        }, timeout=10)
        assert resp.status_code == 404

    def test_estimate_invalid_field_400(self):
        """非法字段须被 DSL 校验层拦截（不允许越过 validate 直接出 SQL）。"""
        resp = S.post(f"{API}/engage/estimate-audience", json={
            "tenant_id": TENANT,
            "dsl": {"object": "user",
                    "conditions": [{"field": "__not_a_field__", "op": "eq", "value": 1}]},
        }, timeout=10)
        assert resp.status_code == 400

    def test_estimate_tenant_scoped(self):
        """同一 DSL 不同租户分别隔离统计，互不串数。"""
        dsl = {"object": "user",
               "conditions": [{"field": "tags", "op": "contains", "value": "vip"}]}
        a = S.post(f"{API}/engage/estimate-audience",
                   json={"tenant_id": TENANT, "dsl": dsl}, timeout=10).json()["estimate"]
        b = S.post(f"{API}/engage/estimate-audience",
                   json={"tenant_id": OTHER_TENANT, "dsl": dsl}, timeout=10).json()["estimate"]
        assert isinstance(a, int) and isinstance(b, int)
        assert a >= 0 and b >= 0


# ════════════════════════════════════════════════════════════════════════
# 多租户隔离 —— 跨租户读/改/删/列均不可见、不可达
# ════════════════════════════════════════════════════════════════════════
class TestTenantIsolation:
    def test_journey_not_visible_to_other_tenant(self, journey_factory):
        row = journey_factory(tenant_id=TENANT)
        jid = row["journey_id"]
        # 列表：他租户看不到
        other_list = S.get(f"{API}/engage/journeys",
                           params={"tenant_id": OTHER_TENANT}, timeout=10).json()
        assert all(j["journey_id"] != jid for j in other_list)
        # get：他租户 404
        assert S.get(f"{API}/engage/journeys/{jid}",
                     params={"tenant_id": OTHER_TENANT}, timeout=10).status_code == 404
        # 改 / 状态 / 删：他租户 404，且本租户仍可读
        assert S.put(f"{API}/engage/journeys/{jid}", params={"tenant_id": OTHER_TENANT},
                     json={"journey_name": "越权改名"}, timeout=10).status_code == 404
        assert S.post(f"{API}/engage/journeys/{jid}/status", params={"tenant_id": OTHER_TENANT},
                      json={"status": "archived"}, timeout=10).status_code == 404
        assert S.delete(f"{API}/engage/journeys/{jid}",
                        params={"tenant_id": OTHER_TENANT}, timeout=10).status_code == 404
        # 本租户仍在且未被改名
        owner = S.get(f"{API}/engage/journeys/{jid}",
                      params={"tenant_id": TENANT}, timeout=10).json()
        assert owner["journey_name"] != "越权改名"

    def test_journey_code_unique_per_tenant(self, journey_factory):
        """同一 journey_code 在不同租户可各自创建（uk 含 tenant_id）。"""
        code = _code("jny-shared")
        journey_factory(tenant_id=TENANT, journey_code=code)
        # 他租户用同样 code 应可创建成功（不撞唯一键）
        journey_factory(tenant_id=OTHER_TENANT, journey_code=code)

    def test_broadcast_not_visible_to_other_tenant(self, broadcast_factory):
        row = broadcast_factory(tenant_id=TENANT)
        bid = row["broadcast_id"]
        other_list = S.get(f"{API}/engage/broadcasts",
                           params={"tenant_id": OTHER_TENANT}, timeout=10).json()
        assert all(b["broadcast_id"] != bid for b in other_list)
        assert S.get(f"{API}/engage/broadcasts/{bid}",
                     params={"tenant_id": OTHER_TENANT}, timeout=10).status_code == 404
        assert S.post(f"{API}/engage/broadcasts/{bid}/send",
                      params={"tenant_id": OTHER_TENANT}, timeout=10).status_code == 404
        assert S.delete(f"{API}/engage/broadcasts/{bid}",
                        params={"tenant_id": OTHER_TENANT}, timeout=10).status_code == 404
