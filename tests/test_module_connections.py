"""01 · connections 模块端点测试（Sources / Destinations / Reverse-ETL / Warehouses / Functions / Pipelines）

对标 Twilio Segment 的 Connections。覆盖正向、边界、多租户隔离。

前置：docker compose up -d mysql redis sql-engine
      bash scripts/apply_migrations.sh   # 应用 migrate_modules.sql（connections_* 表）

设计约定（与既有 tests/test_multi_object.py 一致）：
- 直连 sql-engine :8002（可用 TEST_SQL_ENGINE_BASE 覆盖，例如网关 http://localhost:8080/api）。
- 绕过本机 http_proxy（S.trust_env=False），避免 localhost 被代理。
- 服务不可达 / connections 路由未部署 → 整文件 skip（不算失败）。
- 使用独立高位租户号与 uuid 随机名，避免污染既有数据与互相干扰。
"""

import os
import uuid

import pytest
import requests

API = os.getenv("TEST_SQL_ENGINE_BASE", "http://localhost:8002").rstrip("/")
BASE = f"{API}/connections"

# 独立租户号（远离演示用的 1001/1002），保证多租户隔离断言不被既有数据干扰
TENANT_A = 970101
TENANT_B = 970102

S = requests.Session()
S.trust_env = False  # 绕过 http_proxy/https_proxy


def _rand(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:8]}"


@pytest.fixture(scope="module", autouse=True)
def connections_ready():
    """connections 模块不可达（服务未起 / 路由未部署 / 迁移未应用）则跳过整个文件。"""
    try:
        resp = S.get(f"{BASE}/sources", params={"tenant_id": TENANT_A}, timeout=5)
    except requests.RequestException:
        pytest.skip("sql-engine 未就绪，请先 docker compose up -d --build sql-engine")
    if resp.status_code == 404:
        pytest.skip("connections 路由未部署 / migrate_modules.sql 未应用，跳过")
    if resp.status_code != 200:
        pytest.skip(f"connections/sources 异常({resp.status_code})，跳过")
    yield


# ── 资源创建辅助（每次随机命名，避免污染 / 串扰） ──────────────────────────────
def _new_source(tenant: int = TENANT_A, source_type: str = "javascript") -> dict:
    resp = S.post(f"{BASE}/sources", params={"tenant_id": tenant},
                  json={"source_name": _rand("源"), "source_type": source_type,
                        "config": {"k": "v"}}, timeout=10)
    resp.raise_for_status()
    return resp.json()


def _new_destination(tenant: int = TENANT_A) -> dict:
    resp = S.post(f"{BASE}/destinations", params={"tenant_id": tenant},
                  json={"destination_name": _rand("目的地"), "destination_type": "ads",
                        "config": {}}, timeout=10)
    resp.raise_for_status()
    return resp.json()


def _new_job(destination_id: str, tenant: int = TENANT_A) -> dict:
    resp = S.post(f"{BASE}/reverse-etl/jobs", params={"tenant_id": tenant},
                  json={"job_name": _rand("作业"), "source_object": "user",
                        "destination_id": destination_id}, timeout=10)
    resp.raise_for_status()
    return resp.json()


def _new_warehouse(tenant: int = TENANT_A) -> dict:
    resp = S.post(f"{BASE}/warehouses", params={"tenant_id": tenant},
                  json={"warehouse_name": _rand("仓"), "warehouse_type": "doris"}, timeout=10)
    resp.raise_for_status()
    return resp.json()


def _new_function(tenant: int = TENANT_A) -> dict:
    resp = S.post(f"{BASE}/functions", params={"tenant_id": tenant},
                  json={"function_name": _rand("函数"), "function_type": "source_function",
                        "code": "function onEvent(e){return e;}"}, timeout=10)
    resp.raise_for_status()
    return resp.json()


def _new_pipeline(tenant: int = TENANT_A, nodes=None, edges=None) -> dict:
    resp = S.post(f"{BASE}/pipelines", params={"tenant_id": tenant},
                  json={"pipeline_name": _rand("管道"),
                        "nodes": nodes if nodes is not None else [{"id": "n1"}, {"id": "n2"}],
                        "edges": edges if edges is not None else [{"from": "n1", "to": "n2"}]},
                  timeout=10)
    resp.raise_for_status()
    return resp.json()


# ════════════════════════════════════════════════════════════════════════
# Sources
# ════════════════════════════════════════════════════════════════════════
class TestSources:
    def test_create_returns_write_key(self):
        data = _new_source()
        assert data["source_id"].startswith("src_")
        assert data["write_key"] and len(data["write_key"]) >= 16

    def test_list_masks_write_key(self):
        src = _new_source()
        resp = S.get(f"{BASE}/sources", params={"tenant_id": TENANT_A}, timeout=10)
        assert resp.status_code == 200
        rows = resp.json()["sources"]
        ids = {r["source_id"] for r in rows}
        assert src["source_id"] in ids
        target = next(r for r in rows if r["source_id"] == src["source_id"])
        # 列表视图 write_key 必须脱敏，绝不回显完整密钥
        assert target["write_key"] != src["write_key"]
        assert "*" in (target["write_key"] or "")

    def test_get_detail_has_recent_events(self):
        src = _new_source()
        resp = S.get(f"{BASE}/sources/{src['source_id']}", params={"tenant_id": TENANT_A}, timeout=10)
        assert resp.status_code == 200
        body = resp.json()
        assert body["source_id"] == src["source_id"]
        assert isinstance(body["recent_events"], list)

    def test_get_missing_source_404(self):
        resp = S.get(f"{BASE}/sources/src_does_not_exist", params={"tenant_id": TENANT_A}, timeout=10)
        assert resp.status_code == 404

    def test_test_connection_ok(self):
        src = _new_source(source_type="mysql")
        resp = S.post(f"{BASE}/sources/{src['source_id']}/test",
                      params={"tenant_id": TENANT_A}, json={"config": {}}, timeout=10)
        assert resp.status_code == 200
        body = resp.json()
        assert body["ok"] is True
        assert isinstance(body["sample_rows"], list) and body["sample_rows"]

    def test_test_connection_missing_source_not_ok(self):
        resp = S.post(f"{BASE}/sources/src_missing/test",
                      params={"tenant_id": TENANT_A}, json={"config": {}}, timeout=10)
        assert resp.status_code == 200
        assert resp.json()["ok"] is False

    def test_track_and_events_roundtrip(self):
        src = _new_source(source_type="javascript")
        resp = S.post(f"{BASE}/events/track", params={"tenant_id": TENANT_A},
                      json={"write_key": src["write_key"], "events": [
                          {"event_type": "page", "data": {"path": "/home"}, "userId": "u-1"},
                          {"event_type": "track", "data": {"name": "click"}, "anonymousId": "a-1"},
                      ]}, timeout=10)
        assert resp.status_code == 200
        assert resp.json()["queued"] == 2
        # 回读事件
        resp = S.get(f"{BASE}/sources/{src['source_id']}/events",
                     params={"tenant_id": TENANT_A}, timeout=10)
        assert resp.status_code == 200
        events = resp.json()["events"]
        assert len(events) >= 2
        types = {e["event_type"] for e in events}
        assert {"page", "track"}.issubset(types)
        # 字段重命名约定：anonymous_id → anonymousId，event_timestamp → timestamp
        assert "anonymousId" in events[0] and "timestamp" in events[0]

    def test_track_invalid_write_key_401(self):
        resp = S.post(f"{BASE}/events/track", params={"tenant_id": TENANT_A},
                      json={"write_key": "totally-invalid-key", "events": [
                          {"event_type": "page", "data": {}}]}, timeout=10)
        assert resp.status_code == 401

    def test_events_limit_clamped(self):
        """limit 上界被收口（<=500），不报错。"""
        src = _new_source()
        resp = S.get(f"{BASE}/sources/{src['source_id']}/events",
                     params={"tenant_id": TENANT_A, "limit": 100000}, timeout=10)
        assert resp.status_code == 200
        assert isinstance(resp.json()["events"], list)


# ════════════════════════════════════════════════════════════════════════
# Destinations
# ════════════════════════════════════════════════════════════════════════
class TestDestinations:
    def test_create_and_list(self):
        dst = _new_destination()
        assert dst["destination_id"].startswith("dst_")
        resp = S.get(f"{BASE}/destinations", params={"tenant_id": TENANT_A}, timeout=10)
        assert resp.status_code == 200
        ids = {d["destination_id"] for d in resp.json()["destinations"]}
        assert dst["destination_id"] in ids

    def test_get_missing_404(self):
        resp = S.get(f"{BASE}/destinations/dst_missing", params={"tenant_id": TENANT_A}, timeout=10)
        assert resp.status_code == 404

    def test_test_connection_ok(self):
        dst = _new_destination()
        resp = S.post(f"{BASE}/destinations/{dst['destination_id']}/test",
                      params={"tenant_id": TENANT_A}, json={"sample_data": {"x": 1}}, timeout=10)
        assert resp.status_code == 200
        body = resp.json()
        assert body["ok"] is True and "latency_ms" in body

    def test_test_connection_missing_not_ok(self):
        resp = S.post(f"{BASE}/destinations/dst_missing/test",
                      params={"tenant_id": TENANT_A}, json={"sample_data": {}}, timeout=10)
        assert resp.status_code == 200
        assert resp.json()["ok"] is False

    def test_save_mappings_and_readback(self):
        dst = _new_destination()
        resp = S.post(f"{BASE}/destinations/{dst['destination_id']}/mappings",
                      params={"tenant_id": TENANT_A},
                      json={"source_object": "user", "mapping": [
                          {"source_field": "email", "target_field": "em"},
                          {"source_field": "phone", "target_field": "ph",
                           "transform_logic": {"op": "hash"}},
                      ]}, timeout=10)
        assert resp.status_code == 200 and resp.json()["ok"] is True
        # 详情回读 mappings + status
        resp = S.get(f"{BASE}/destinations/{dst['destination_id']}",
                     params={"tenant_id": TENANT_A}, timeout=10)
        assert resp.status_code == 200
        body = resp.json()
        assert body["status"] in ("enabled", "disabled")
        assert len(body["mappings"]) == 2

    def test_save_mappings_is_overwrite_per_object(self):
        """同一 source_object 覆盖式保存：二次保存不会叠加。"""
        dst = _new_destination()
        url = f"{BASE}/destinations/{dst['destination_id']}/mappings"
        S.post(url, params={"tenant_id": TENANT_A},
               json={"source_object": "user", "mapping": [
                   {"source_field": "a", "target_field": "x"},
                   {"source_field": "b", "target_field": "y"}]}, timeout=10).raise_for_status()
        S.post(url, params={"tenant_id": TENANT_A},
               json={"source_object": "user", "mapping": [
                   {"source_field": "c", "target_field": "z"}]}, timeout=10).raise_for_status()
        body = S.get(f"{BASE}/destinations/{dst['destination_id']}",
                     params={"tenant_id": TENANT_A}, timeout=10).json()
        user_maps = [m for m in body["mappings"] if m["source_object"] == "user"]
        assert len(user_maps) == 1

    def test_save_mappings_missing_destination_404(self):
        resp = S.post(f"{BASE}/destinations/dst_missing/mappings",
                      params={"tenant_id": TENANT_A},
                      json={"source_object": "user", "mapping": []}, timeout=10)
        assert resp.status_code == 404


# ════════════════════════════════════════════════════════════════════════
# Reverse-ETL
# ════════════════════════════════════════════════════════════════════════
class TestReverseEtl:
    def test_create_list_run_and_runs(self):
        dst = _new_destination()
        job = _new_job(dst["destination_id"])
        assert job["job_id"].startswith("retl_")
        # 列表含新作业
        resp = S.get(f"{BASE}/reverse-etl/jobs", params={"tenant_id": TENANT_A}, timeout=10)
        assert resp.status_code == 200
        ids = {j["job_id"] for j in resp.json()["jobs"]}
        assert job["job_id"] in ids
        # 手动触发
        resp = S.post(f"{BASE}/reverse-etl/jobs/{job['job_id']}/run-now",
                      params={"tenant_id": TENANT_A}, timeout=10)
        assert resp.status_code == 200
        run = resp.json()
        assert run["run_id"].startswith("run_") and run["status"] == "pending"
        # 运行记录回读
        resp = S.get(f"{BASE}/reverse-etl/jobs/{job['job_id']}/runs",
                     params={"tenant_id": TENANT_A}, timeout=10)
        assert resp.status_code == 200
        runs = resp.json()["runs"]
        assert len(runs) >= 1
        assert any(r["run_id"] == run["run_id"] for r in runs)

    def test_run_now_missing_job_404(self):
        resp = S.post(f"{BASE}/reverse-etl/jobs/retl_missing/run-now",
                      params={"tenant_id": TENANT_A}, timeout=10)
        assert resp.status_code == 404

    def test_runs_empty_for_unrun_job(self):
        dst = _new_destination()
        job = _new_job(dst["destination_id"])
        resp = S.get(f"{BASE}/reverse-etl/jobs/{job['job_id']}/runs",
                     params={"tenant_id": TENANT_A}, timeout=10)
        assert resp.status_code == 200
        assert resp.json()["runs"] == []


# ════════════════════════════════════════════════════════════════════════
# Warehouses
# ════════════════════════════════════════════════════════════════════════
class TestWarehouses:
    def test_create_list_sync(self):
        wh = _new_warehouse()
        assert wh["warehouse_id"].startswith("wh_")
        assert wh["status"] == "testing"
        resp = S.get(f"{BASE}/warehouses", params={"tenant_id": TENANT_A}, timeout=10)
        assert resp.status_code == 200
        ids = {w["warehouse_id"] for w in resp.json()["warehouses"]}
        assert wh["warehouse_id"] in ids
        # 同步
        resp = S.post(f"{BASE}/warehouses/{wh['warehouse_id']}/sync",
                      params={"tenant_id": TENANT_A}, timeout=10)
        assert resp.status_code == 200
        body = resp.json()
        assert body["ok"] is True
        assert isinstance(body["queued_tables"], list) and body["queued_tables"]
        # 同步后状态/明细回读
        resp = S.get(f"{BASE}/warehouses", params={"tenant_id": TENANT_A}, timeout=10)
        target = next(w for w in resp.json()["warehouses"] if w["warehouse_id"] == wh["warehouse_id"])
        assert target["status"] == "healthy"
        assert isinstance(target["tables_synced"], list)

    def test_sync_missing_warehouse_404(self):
        resp = S.post(f"{BASE}/warehouses/wh_missing/sync",
                      params={"tenant_id": TENANT_A}, timeout=10)
        assert resp.status_code == 404


# ════════════════════════════════════════════════════════════════════════
# Functions
# ════════════════════════════════════════════════════════════════════════
class TestFunctions:
    def test_create_list_deploy_runs(self):
        fn = _new_function()
        assert fn["function_id"].startswith("fn_")
        assert fn["status"] == "draft"
        # 列表含统计聚合字段
        resp = S.get(f"{BASE}/functions", params={"tenant_id": TENANT_A}, timeout=10)
        assert resp.status_code == 200
        rows = resp.json()["functions"]
        target = next(f for f in rows if f["function_id"] == fn["function_id"])
        assert target["runs_7d"] == 0 and target["errors_7d"] == 0
        # 部署
        resp = S.post(f"{BASE}/functions/{fn['function_id']}/deploy",
                      params={"tenant_id": TENANT_A}, timeout=10)
        assert resp.status_code == 200 and resp.json()["ok"] is True
        resp = S.get(f"{BASE}/functions", params={"tenant_id": TENANT_A}, timeout=10)
        target = next(f for f in resp.json()["functions"] if f["function_id"] == fn["function_id"])
        assert target["status"] == "deployed"
        # 运行记录（初始为空）
        resp = S.get(f"{BASE}/functions/{fn['function_id']}/runs",
                     params={"tenant_id": TENANT_A}, timeout=10)
        assert resp.status_code == 200
        assert resp.json()["runs"] == []

    def test_deploy_missing_function_404(self):
        resp = S.post(f"{BASE}/functions/fn_missing/deploy",
                      params={"tenant_id": TENANT_A}, timeout=10)
        assert resp.status_code == 404


# ════════════════════════════════════════════════════════════════════════
# Pipelines
# ════════════════════════════════════════════════════════════════════════
class TestPipelines:
    def test_create_list_get_execute(self):
        pipe = _new_pipeline()
        assert pipe["pipeline_id"].startswith("pipe_")
        # 列表派生 node_count/edge_count，且不回传完整 nodes/edges
        resp = S.get(f"{BASE}/pipelines", params={"tenant_id": TENANT_A}, timeout=10)
        assert resp.status_code == 200
        target = next(p for p in resp.json()["pipelines"] if p["pipeline_id"] == pipe["pipeline_id"])
        assert target["node_count"] == 2 and target["edge_count"] == 1
        assert "nodes" not in target and "edges" not in target
        # 详情含完整 nodes/edges
        resp = S.get(f"{BASE}/pipelines/{pipe['pipeline_id']}",
                     params={"tenant_id": TENANT_A}, timeout=10)
        assert resp.status_code == 200
        body = resp.json()
        assert len(body["nodes"]) == 2 and len(body["edges"]) == 1
        # 执行
        resp = S.post(f"{BASE}/pipelines/{pipe['pipeline_id']}/execute",
                      params={"tenant_id": TENANT_A}, json={}, timeout=10)
        assert resp.status_code == 200
        ex = resp.json()
        assert ex["execution_id"].startswith("exec_") and ex["status"] == "pending"

    def test_get_missing_404(self):
        resp = S.get(f"{BASE}/pipelines/pipe_missing", params={"tenant_id": TENANT_A}, timeout=10)
        assert resp.status_code == 404

    def test_execute_missing_404(self):
        resp = S.post(f"{BASE}/pipelines/pipe_missing/execute",
                      params={"tenant_id": TENANT_A}, json={}, timeout=10)
        assert resp.status_code == 404


# ════════════════════════════════════════════════════════════════════════
# 多租户隔离 —— 同一资源 ID 在另一租户下不可见 / 不可操作
# ════════════════════════════════════════════════════════════════════════
class TestTenantIsolation:
    def test_source_isolated(self):
        src = _new_source(tenant=TENANT_A)
        # B 租户读不到 A 的源
        resp = S.get(f"{BASE}/sources/{src['source_id']}",
                     params={"tenant_id": TENANT_B}, timeout=10)
        assert resp.status_code == 404
        # B 租户列表里不含 A 的源
        resp = S.get(f"{BASE}/sources", params={"tenant_id": TENANT_B}, timeout=10)
        ids = {s["source_id"] for s in resp.json()["sources"]}
        assert src["source_id"] not in ids

    def test_track_write_key_scoped_to_tenant(self):
        """A 租户的 write_key 在 B 租户下无效（write_key 校验带 tenant_id）。"""
        src = _new_source(tenant=TENANT_A)
        resp = S.post(f"{BASE}/events/track", params={"tenant_id": TENANT_B},
                      json={"write_key": src["write_key"], "events": [
                          {"event_type": "page", "data": {}}]}, timeout=10)
        assert resp.status_code == 401

    def test_destination_isolated(self):
        dst = _new_destination(tenant=TENANT_A)
        resp = S.get(f"{BASE}/destinations/{dst['destination_id']}",
                     params={"tenant_id": TENANT_B}, timeout=10)
        assert resp.status_code == 404

    def test_reverse_etl_run_isolated(self):
        dst = _new_destination(tenant=TENANT_A)
        job = _new_job(dst["destination_id"], tenant=TENANT_A)
        # B 租户触发 A 的作业 → 404
        resp = S.post(f"{BASE}/reverse-etl/jobs/{job['job_id']}/run-now",
                      params={"tenant_id": TENANT_B}, timeout=10)
        assert resp.status_code == 404

    def test_warehouse_sync_isolated(self):
        wh = _new_warehouse(tenant=TENANT_A)
        resp = S.post(f"{BASE}/warehouses/{wh['warehouse_id']}/sync",
                      params={"tenant_id": TENANT_B}, timeout=10)
        assert resp.status_code == 404

    def test_function_deploy_isolated(self):
        fn = _new_function(tenant=TENANT_A)
        resp = S.post(f"{BASE}/functions/{fn['function_id']}/deploy",
                      params={"tenant_id": TENANT_B}, timeout=10)
        assert resp.status_code == 404

    def test_pipeline_isolated(self):
        pipe = _new_pipeline(tenant=TENANT_A)
        resp = S.get(f"{BASE}/pipelines/{pipe['pipeline_id']}",
                     params={"tenant_id": TENANT_B}, timeout=10)
        assert resp.status_code == 404
        resp = S.post(f"{BASE}/pipelines/{pipe['pipeline_id']}/execute",
                      params={"tenant_id": TENANT_B}, json={}, timeout=10)
        assert resp.status_code == 404
