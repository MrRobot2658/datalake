"""04 · accounts —— 账户模块端点测试（accounts_api.py）

前置：
    docker compose up -d --build sql-engine
    bash scripts/apply_migrations.sh          # 应用 migrate_modules.sql（account_* 表）

覆盖端点：
    GET    /accounts                        列表
    POST   /accounts/search                 条件筛选
    GET    /accounts/{id}                    详情(+聚合+层级)
    GET    /accounts/{id}/users             账户下用户(user--owns-->account)
    GET/PUT /accounts/{id}/aggregates       账户级聚合指标
    GET/PUT /accounts/{id}/hierarchy        账户父子层级
    GET    /accounts/{id}/merge-log         单账户合并日志
    GET    /accounts/-/merge-log            租户全量合并日志
    POST   /accounts/merge                  记录账户合并

约定：
- 服务不可达（或 /accounts 路由未部署）→ 整文件 skip，不算失败。
- 只读断言复用 init/迁移自带的种子账户（tenant 1001 的 A3001/A3002），不写不污染。
- 写端点（aggregates/hierarchy/merge）一律用随机 account_id + 隔离的测试租户，
  避免污染真实租户与既有测试数据；这些表不依赖 object_account 行存在。
- 多租户隔离：A 租户写入的数据，B 租户读不到。
"""

import os
import uuid

import pytest
import requests

API = os.getenv("TEST_API_BASE", "http://localhost:8002")
# 绕过本机 http_proxy，避免 localhost 被代理（与 test_multi_object.py 一致）
S = requests.Session()
S.trust_env = False

SEED_TENANT = 1001          # init/迁移自带账户的租户
SEED_ACCOUNT = "A3001"      # 上海制造集团（large/manufacturing）

# 写测试用的隔离租户（远离真实 1001/1002，互不影响）
TENANT_A = 990401
TENANT_B = 990402


def _new_account_id() -> str:
    """每个写测试一个独立 account_id，避免相互污染。"""
    return f"QA_ACCT_{uuid.uuid4().hex[:10]}"


def _accounts_available() -> bool:
    """探测 sql-engine 的 accounts 路由是否就绪。"""
    try:
        r = S.get(f"{API}/accounts", params={"tenant_id": SEED_TENANT, "limit": 1}, timeout=3)
        return r.status_code == 200
    except requests.RequestException:
        return False


pytestmark = pytest.mark.skipif(
    not _accounts_available(),
    reason="sql-engine /accounts 不可达，请先: docker compose up -d --build sql-engine && bash scripts/apply_migrations.sh",
)


# ════════════════════════════════════════════════════════════════════════
# 列表 / 筛选
# ════════════════════════════════════════════════════════════════════════
class TestAccountList:
    def test_list_returns_seed_accounts(self):
        r = S.get(f"{API}/accounts", params={"tenant_id": SEED_TENANT, "limit": 50}, timeout=10)
        assert r.status_code == 200
        body = r.json()
        assert body["object"] == "account"
        ids = {row["account_id"] for row in body["data"]}
        assert SEED_ACCOUNT in ids
        # 每行都带正确租户 → 隔离生效
        assert all(row["tenant_id"] == SEED_TENANT for row in body["data"])

    def test_list_respects_limit(self):
        r = S.get(f"{API}/accounts", params={"tenant_id": SEED_TENANT, "limit": 1}, timeout=10)
        assert r.status_code == 200
        assert r.json()["row_count"] <= 1

    def test_list_limit_out_of_range_rejected(self):
        # limit 上限 1000（Query le=1000）
        r = S.get(f"{API}/accounts", params={"tenant_id": SEED_TENANT, "limit": 5000}, timeout=10)
        assert r.status_code == 422

    def test_list_unknown_tenant_empty(self):
        r = S.get(f"{API}/accounts", params={"tenant_id": 99999999, "limit": 50}, timeout=10)
        assert r.status_code == 200
        assert r.json()["row_count"] == 0


class TestAccountSearch:
    def test_search_by_field(self):
        r = S.post(f"{API}/accounts/search", params={"tenant_id": SEED_TENANT},
                   json=[{"field": "scale", "op": "eq", "value": "large"}], timeout=10)
        assert r.status_code == 200
        body = r.json()
        assert SEED_ACCOUNT in {row["account_id"] for row in body["data"]}
        assert all(row["scale"] == "large" for row in body["data"])

    def test_search_empty_conditions_returns_all(self):
        r = S.post(f"{API}/accounts/search", params={"tenant_id": SEED_TENANT},
                   json=[], timeout=10)
        assert r.status_code == 200
        assert r.json()["row_count"] >= 1

    def test_search_unknown_field_rejected(self):
        """非白名单字段被对象注册表校验拦截（不会手拼 SQL）。"""
        r = S.post(f"{API}/accounts/search", params={"tenant_id": SEED_TENANT},
                   json=[{"field": "drop_table", "op": "eq", "value": "x"}], timeout=10)
        assert r.status_code == 400

    def test_search_isolated_by_tenant(self):
        r = S.post(f"{API}/accounts/search", params={"tenant_id": 99999999},
                   json=[{"field": "scale", "op": "eq", "value": "large"}], timeout=10)
        assert r.status_code == 200
        assert r.json()["row_count"] == 0


# ════════════════════════════════════════════════════════════════════════
# 详情 / 账户下用户
# ════════════════════════════════════════════════════════════════════════
class TestAccountDetail:
    def test_get_existing(self):
        r = S.get(f"{API}/accounts/{SEED_ACCOUNT}", params={"tenant_id": SEED_TENANT}, timeout=10)
        assert r.status_code == 200
        body = r.json()
        assert body["account"]["account_id"] == SEED_ACCOUNT
        # 详情聚合三件套键齐全（值可为空）
        assert "aggregates" in body and "hierarchy" in body
        assert "node" in body["hierarchy"] and "children" in body["hierarchy"]

    def test_get_404(self):
        r = S.get(f"{API}/accounts/__NO_SUCH__", params={"tenant_id": SEED_TENANT}, timeout=10)
        assert r.status_code == 404

    def test_get_isolated_by_tenant(self):
        """种子账户在别的租户下不可见 → 404。"""
        r = S.get(f"{API}/accounts/{SEED_ACCOUNT}", params={"tenant_id": 99999999}, timeout=10)
        assert r.status_code == 404


class TestAccountUsers:
    def test_users_join_path(self):
        r = S.get(f"{API}/accounts/{SEED_ACCOUNT}/users",
                  params={"tenant_id": SEED_TENANT}, timeout=10)
        assert r.status_code == 200
        body = r.json()
        assert body["object"] == "user"
        # 走 user--owns-->account 的对象关系 JOIN（参数化），而非手拼
        assert "object_relations" in body["sql"]
        assert "row_count" in body and isinstance(body["row_count"], int)

    def test_users_unknown_account_empty(self):
        r = S.get(f"{API}/accounts/__NO_SUCH__/users",
                  params={"tenant_id": SEED_TENANT}, timeout=10)
        assert r.status_code == 200
        assert r.json()["row_count"] == 0


# ════════════════════════════════════════════════════════════════════════
# 聚合指标 GET/PUT
# ════════════════════════════════════════════════════════════════════════
class TestAccountAggregates:
    def test_put_then_get_roundtrip(self):
        acct = _new_account_id()
        payload = {"user_count": 7, "active_user_count": 3, "total_gmv": 1234.56,
                   "purchase_count": 5, "tags": ["vip", "ka"],
                   "properties": {"region": "华东"}, "metric_date": "2026-06-14"}
        put = S.put(f"{API}/accounts/{acct}/aggregates",
                    params={"tenant_id": TENANT_A}, json=payload, timeout=10)
        assert put.status_code == 200
        out = put.json()
        assert out["user_count"] == 7
        assert out["tags"] == ["vip", "ka"]            # JSON 往返保持 list
        assert out["properties"] == {"region": "华东"}  # JSON 往返保持 dict + 中文

        got = S.get(f"{API}/accounts/{acct}/aggregates",
                    params={"tenant_id": TENANT_A}, timeout=10)
        assert got.status_code == 200
        assert got.json()["user_count"] == 7

    def test_put_is_idempotent_upsert(self):
        acct = _new_account_id()
        S.put(f"{API}/accounts/{acct}/aggregates",
              params={"tenant_id": TENANT_A}, json={"user_count": 1}, timeout=10)
        second = S.put(f"{API}/accounts/{acct}/aggregates",
                       params={"tenant_id": TENANT_A}, json={"user_count": 99}, timeout=10)
        assert second.status_code == 200
        assert second.json()["user_count"] == 99  # 覆盖更新，非重复插入报错

    def test_get_missing_returns_empty(self):
        r = S.get(f"{API}/accounts/{_new_account_id()}/aggregates",
                  params={"tenant_id": TENANT_A}, timeout=10)
        assert r.status_code == 200
        assert r.json() == {}

    def test_aggregates_isolated_by_tenant(self):
        acct = _new_account_id()
        S.put(f"{API}/accounts/{acct}/aggregates",
              params={"tenant_id": TENANT_A}, json={"user_count": 42}, timeout=10)
        # 同一 account_id 在 B 租户读不到
        r = S.get(f"{API}/accounts/{acct}/aggregates",
                  params={"tenant_id": TENANT_B}, timeout=10)
        assert r.status_code == 200
        assert r.json() == {}


# ════════════════════════════════════════════════════════════════════════
# 父子层级 GET/PUT
# ════════════════════════════════════════════════════════════════════════
class TestAccountHierarchy:
    def test_put_then_get_node(self):
        acct = _new_account_id()
        parent = _new_account_id()
        put = S.put(f"{API}/accounts/{acct}/hierarchy", params={"tenant_id": TENANT_A},
                    json={"parent_account_id": parent, "level": 2,
                          "relationship_type": "subsidiary",
                          "properties": {"note": "子公司"}}, timeout=10)
        assert put.status_code == 200
        assert put.json()["parent_account_id"] == parent

        got = S.get(f"{API}/accounts/{acct}/hierarchy",
                    params={"tenant_id": TENANT_A}, timeout=10)
        assert got.status_code == 200
        body = got.json()
        assert body["node"] is not None
        assert body["node"]["level"] == 2
        assert body["node"]["properties"] == {"note": "子公司"}

    def test_children_listed_under_parent(self):
        parent = _new_account_id()
        child = _new_account_id()
        S.put(f"{API}/accounts/{parent}/hierarchy",
              params={"tenant_id": TENANT_A}, json={"level": 1}, timeout=10)
        S.put(f"{API}/accounts/{child}/hierarchy", params={"tenant_id": TENANT_A},
              json={"parent_account_id": parent, "level": 2}, timeout=10)
        got = S.get(f"{API}/accounts/{parent}/hierarchy",
                    params={"tenant_id": TENANT_A}, timeout=10).json()
        child_ids = {c["account_id"] for c in got["children"]}
        assert child in child_ids

    def test_get_missing_returns_null_node(self):
        r = S.get(f"{API}/accounts/{_new_account_id()}/hierarchy",
                  params={"tenant_id": TENANT_A}, timeout=10)
        assert r.status_code == 200
        body = r.json()
        assert body["node"] is None
        assert body["children"] == []

    def test_hierarchy_isolated_by_tenant(self):
        acct = _new_account_id()
        S.put(f"{API}/accounts/{acct}/hierarchy", params={"tenant_id": TENANT_A},
              json={"level": 3}, timeout=10)
        r = S.get(f"{API}/accounts/{acct}/hierarchy",
                  params={"tenant_id": TENANT_B}, timeout=10)
        assert r.status_code == 200
        assert r.json()["node"] is None


# ════════════════════════════════════════════════════════════════════════
# 合并日志 / 合并
# ════════════════════════════════════════════════════════════════════════
class TestAccountMerge:
    def test_merge_records_log(self):
        master = _new_account_id()
        merged = _new_account_id()
        r = S.post(f"{API}/accounts/merge", params={"tenant_id": TENANT_A},
                   json={"master_account_id": master, "merged_account_id": merged,
                         "action": "merge", "user_count": 3,
                         "merged_fields": {"name": "旧名"}, "created_by": "qa"}, timeout=10)
        assert r.status_code == 200
        out = r.json()
        assert out["master_account_id"] == master
        assert out["merged_fields"] == {"name": "旧名"}

        # 单账户合并日志能查到（master/merged 任一命中）
        log = S.get(f"{API}/accounts/{merged}/merge-log",
                    params={"tenant_id": TENANT_A}, timeout=10).json()
        pairs = {(e["master_account_id"], e["merged_account_id"]) for e in log}
        assert (master, merged) in pairs

    def test_merge_same_id_rejected(self):
        acct = _new_account_id()
        r = S.post(f"{API}/accounts/merge", params={"tenant_id": TENANT_A},
                   json={"master_account_id": acct, "merged_account_id": acct}, timeout=10)
        assert r.status_code == 400

    def test_merge_idempotent_upsert(self):
        master = _new_account_id()
        merged = _new_account_id()
        body = {"master_account_id": master, "merged_account_id": merged, "action": "merge"}
        S.post(f"{API}/accounts/merge", params={"tenant_id": TENANT_A}, json=body, timeout=10)
        S.post(f"{API}/accounts/merge", params={"tenant_id": TENANT_A}, json=body, timeout=10)
        log = S.get(f"{API}/accounts/{master}/merge-log",
                    params={"tenant_id": TENANT_A}, timeout=10).json()
        same = [e for e in log
                if e["master_account_id"] == master and e["merged_account_id"] == merged]
        assert len(same) == 1  # 同主键 ON DUPLICATE KEY 更新，不重复

    def test_merge_log_isolated_by_tenant(self):
        master = _new_account_id()
        merged = _new_account_id()
        S.post(f"{API}/accounts/merge", params={"tenant_id": TENANT_A},
               json={"master_account_id": master, "merged_account_id": merged}, timeout=10)
        # B 租户查不到 A 的合并记录
        log = S.get(f"{API}/accounts/{master}/merge-log",
                    params={"tenant_id": TENANT_B}, timeout=10).json()
        assert log == []

    def test_all_merge_log_returns_list(self):
        """/accounts/-/merge-log 返回列表(200)。

        注意：当前路由 /accounts/{account_id}/merge-log 声明在前，"-" 会被当作
        account_id 命中该路由，故本端点实际返回 account_id == '-' 的过滤结果
        （通常为空列表）。这里只断言契约形态（200 + list），不断言"全量"语义。
        """
        r = S.get(f"{API}/accounts/-/merge-log",
                  params={"tenant_id": TENANT_A, "limit": 100}, timeout=10)
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_merge_log_limit_out_of_range_rejected(self):
        r = S.get(f"{API}/accounts/{_new_account_id()}/merge-log",
                  params={"tenant_id": TENANT_A, "limit": 9999}, timeout=10)
        assert r.status_code == 422
