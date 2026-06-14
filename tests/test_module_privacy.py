"""07 · privacy 模块测试 —— 隐私合规后端（PII / 同意 / 删除工单 / 抑制 / 审计）

对标 Twilio Segment 的 Privacy Portal。覆盖正向、边界与多租户隔离。

前置：docker compose up -d mysql redis sql-engine && bash scripts/apply_migrations.sh
约定：
  - 服务不可达（连接失败）或 privacy 路由未部署（404）时整体 skip，绝不 fail。
  - 用独立测试租户 + 带唯一后缀的数据，避免污染演示租户 1001/1002，且可幂等重跑。
  - 只读/只加，不触碰既有测试与演示数据。
"""

import time
import uuid

import pytest
import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

API = "http://localhost:8002"
# 绕过本机 http_proxy，避免 localhost 被代理（与既有测试一致）
S = requests.Session()
S.trust_env = False
# 密集顺序请求下偶发 keep-alive 连接被服务端关闭（Connection reset by peer），
# 对连接级错误自动重试，保证用例稳定。
_retry = Retry(total=3, connect=3, read=3, backoff_factor=0.2,
               allowed_methods=None, status_forcelist=[])
S.mount("http://", HTTPAdapter(max_retries=_retry))

# 独立测试租户，远离演示租户 1001/1002
TENANT_A = 990107
TENANT_B = 990108

# 每次运行的唯一后缀，保证可重跑且互不串扰
RUN = uuid.uuid4().hex[:8]


def _privacy_ready() -> bool:
    """privacy 路由是否可用：连接失败或 404（未部署）均视为不可用。"""
    try:
        r = S.get(f"{API}/privacy/pii/rules", params={"tenant_id": TENANT_A}, timeout=5)
    except requests.RequestException:
        return False
    return r.status_code == 200


pytestmark = pytest.mark.skipif(
    not _privacy_ready(),
    reason="sql-engine privacy 模块未就绪（服务未启动或路由未部署）",
)


def get(path: str, **params):
    return S.get(f"{API}{path}", params=params, timeout=15)


def post(path: str, body: dict, **params):
    return S.post(f"{API}{path}", json=body, params=params, timeout=15)


def put(path: str, body: dict, **params):
    return S.put(f"{API}{path}", json=body, params=params, timeout=15)


def delete(path: str, **params):
    return S.delete(f"{API}{path}", params=params, timeout=15)


# ════════════════════════════════════════════════════════════════════════
# PII 扫描
# ════════════════════════════════════════════════════════════════════════

class TestPiiScan:
    def test_scan_all_detects_known_pii(self):
        """全量扫描应命中已知 PII 字段（如 phone/email），并返回分类与建议动作。"""
        r = post("/privacy/pii/scan", {"tenant_id": TENANT_A, "scan_depth": "all"})
        assert r.status_code == 200
        data = r.json()
        assert data["scanned_fields"] > 0
        fields = {d["field"] for d in data["detected_fields"]}
        assert "phone" in fields or "email" in fields
        for d in data["detected_fields"]:
            assert 0 < d["confidence"] <= 1
            assert d["suggested_action"] in {"hash", "block", "allow", "mask", "drop", "encrypt"}

    def test_scan_results_sorted_by_confidence(self):
        r = post("/privacy/pii/scan", {"tenant_id": TENANT_A, "scan_depth": "all"})
        assert r.status_code == 200
        confs = [d["confidence"] for d in r.json()["detected_fields"]]
        assert confs == sorted(confs, reverse=True)

    def test_scan_object_scope_narrows(self):
        """scan_depth=object 仅扫描单一对象，命中字段应不多于全量。"""
        full = post("/privacy/pii/scan", {"tenant_id": TENANT_A, "scan_depth": "all"}).json()
        one = post("/privacy/pii/scan", {
            "tenant_id": TENANT_A, "scan_depth": "object", "object_type": "user",
        }).json()
        assert one["scanned_fields"] <= full["scanned_fields"]
        for d in one["detected_fields"]:
            assert d["object"] == "user"

    def test_scan_unknown_object_returns_empty(self):
        """scan_depth=object 指定不存在的对象 → 0 字段，不报错。"""
        r = post("/privacy/pii/scan", {
            "tenant_id": TENANT_A, "scan_depth": "object", "object_type": "__nope__",
        })
        assert r.status_code == 200
        assert r.json()["scanned_fields"] == 0
        assert r.json()["detected_fields"] == []


# ════════════════════════════════════════════════════════════════════════
# PII 规则 CRUD + 多租户隔离
# ════════════════════════════════════════════════════════════════════════

class TestPiiRulesCrud:
    def _field(self) -> str:
        return f"phone_{RUN}_{uuid.uuid4().hex[:6]}"

    def test_create_list_update_delete(self):
        field = self._field()
        # create
        r = post("/privacy/pii/rules", {
            "tenant_id": TENANT_A, "field_name": field, "category": "电话号码",
            "action": "hash", "target_objects": ["user"], "created_by": "pytest",
        })
        assert r.status_code == 200
        rule_id = r.json()["rule_id"]
        assert rule_id

        # list（应能查到刚建的规则）
        r = get("/privacy/pii/rules", tenant_id=TENANT_A)
        assert r.status_code == 200
        rules = {x["rule_id"]: x for x in r.json()["rules"]}
        assert rule_id in rules
        assert rules[rule_id]["action"] == "hash"

        # update（改 action + 停用）
        r = put(f"/privacy/pii/rules/{rule_id}", {"action": "mask"}, tenant_id=TENANT_A)
        assert r.status_code == 200
        assert "updated_at" in r.json()
        r = get("/privacy/pii/rules", tenant_id=TENANT_A)
        assert {x["rule_id"]: x["action"] for x in r.json()["rules"]}[rule_id] == "mask"

        # delete（软删 → is_active=0）
        r = delete(f"/privacy/pii/rules/{rule_id}", tenant_id=TENANT_A)
        assert r.status_code == 200
        assert r.json()["ok"] is True
        r = get("/privacy/pii/rules", tenant_id=TENANT_A)
        assert {x["rule_id"]: x["is_active"] for x in r.json()["rules"]}[rule_id] == 0

    def test_create_idempotent_upsert(self):
        """同租户同字段重复创建 → ON DUPLICATE KEY 更新，rule_id 不变。"""
        field = self._field()
        r1 = post("/privacy/pii/rules", {
            "tenant_id": TENANT_A, "field_name": field, "action": "hash",
        })
        r2 = post("/privacy/pii/rules", {
            "tenant_id": TENANT_A, "field_name": field, "action": "block",
        })
        assert r1.status_code == 200 and r2.status_code == 200
        assert r1.json()["rule_id"] == r2.json()["rule_id"]

    def test_update_missing_rule_404(self):
        r = put("/privacy/pii/rules/99999999", {"action": "mask"}, tenant_id=TENANT_A)
        assert r.status_code == 404

    def test_update_no_fields_400(self):
        field = self._field()
        rid = post("/privacy/pii/rules", {
            "tenant_id": TENANT_A, "field_name": field, "action": "hash",
        }).json()["rule_id"]
        r = put(f"/privacy/pii/rules/{rid}", {}, tenant_id=TENANT_A)
        assert r.status_code == 400

    def test_tenant_isolation(self):
        """A 租户创建的规则，B 租户列表里看不到；B 也无法跨租户更新。"""
        field = self._field()
        rid = post("/privacy/pii/rules", {
            "tenant_id": TENANT_A, "field_name": field, "action": "hash",
        }).json()["rule_id"]

        # B 列表看不到 A 的规则
        r = get("/privacy/pii/rules", tenant_id=TENANT_B)
        assert r.status_code == 200
        assert rid not in {x["rule_id"] for x in r.json()["rules"]}

        # B 跨租户更新 A 的规则 → 404
        r = put(f"/privacy/pii/rules/{rid}", {"action": "mask"}, tenant_id=TENANT_B)
        assert r.status_code == 404

        # A 的规则未被篡改
        r = get("/privacy/pii/rules", tenant_id=TENANT_A)
        assert {x["rule_id"]: x["action"] for x in r.json()["rules"]}[rid] == "hash"


# ════════════════════════════════════════════════════════════════════════
# 同意分类 + 同意记录 + 多租户隔离
# ════════════════════════════════════════════════════════════════════════

class TestConsent:
    def _cat_name(self) -> str:
        return f"营销推送_{RUN}_{uuid.uuid4().hex[:6]}"

    def test_category_create_list_update(self):
        name = self._cat_name()
        r = post("/privacy/consent/categories", {
            "tenant_id": TENANT_A, "category_name": name, "description": "短信/邮件营销",
            "is_required": False, "vendor_list": ["sms", "email"], "created_by": "pytest",
        })
        assert r.status_code == 200
        cid = r.json()["category_id"]
        assert cid

        r = get("/privacy/consent/categories", tenant_id=TENANT_A)
        assert r.status_code == 200
        cats = {c["category_id"]: c for c in r.json()["categories"]}
        assert cid in cats
        # 派生字段：授权率与厂商
        assert "optedIn_pct" in cats[cid]
        assert cats[cid]["vendors"] == ["sms", "email"]

        r = put(f"/privacy/consent/categories/{cid}", {
            "description": "已更新", "is_required": True,
        }, tenant_id=TENANT_A)
        assert r.status_code == 200
        r = get("/privacy/consent/categories", tenant_id=TENANT_A)
        upd = {c["category_id"]: c for c in r.json()["categories"]}[cid]
        assert upd["description"] == "已更新"
        assert upd["is_required"] == 1

    def test_category_update_missing_404(self):
        r = put("/privacy/consent/categories/99999999", {"description": "x"}, tenant_id=TENANT_A)
        assert r.status_code == 404

    def test_record_and_get_consent(self):
        cid = post("/privacy/consent/categories", {
            "tenant_id": TENANT_A, "category_name": self._cat_name(),
        }).json()["category_id"]
        one_id = int(f"99010{int(time.time()) % 100000}")

        # 授权
        r = post("/privacy/consent", {
            "tenant_id": TENANT_A, "one_id": one_id, "category_id": cid, "granted": True,
        })
        assert r.status_code == 200
        assert r.json()["record_id"]

        r = get(f"/privacy/consent/{one_id}", tenant_id=TENANT_A)
        assert r.status_code == 200
        recs = {x["category_id"]: x for x in r.json()["records"]}
        assert cid in recs and recs[cid]["granted"] == 1
        assert recs[cid]["withdrawn_at"] is None

        # 撤回授权（同主体同分类 → upsert，granted=0 且记录撤回时间）
        r = post("/privacy/consent", {
            "tenant_id": TENANT_A, "one_id": one_id, "category_id": cid, "granted": False,
        })
        assert r.status_code == 200
        r = get(f"/privacy/consent/{one_id}", tenant_id=TENANT_A)
        recs = {x["category_id"]: x for x in r.json()["records"]}
        assert recs[cid]["granted"] == 0
        assert recs[cid]["withdrawn_at"] is not None

    def test_consent_tenant_isolation(self):
        """A 写入的同意记录，B 查询同 one_id 时不可见。"""
        cid = post("/privacy/consent/categories", {
            "tenant_id": TENANT_A, "category_name": self._cat_name(),
        }).json()["category_id"]
        one_id = int(f"99020{int(time.time()) % 100000}")
        post("/privacy/consent", {
            "tenant_id": TENANT_A, "one_id": one_id, "category_id": cid, "granted": True,
        })
        r = get(f"/privacy/consent/{one_id}", tenant_id=TENANT_B)
        assert r.status_code == 200
        assert r.json()["records"] == []


# ════════════════════════════════════════════════════════════════════════
# 删除/抑制工单 + 执行 + 抑制校验
# ════════════════════════════════════════════════════════════════════════

class TestDeletionAndSuppression:
    def test_create_get_list_request(self):
        ident = f"del_{RUN}_{uuid.uuid4().hex[:6]}@test.local"
        r = post("/privacy/deletion", {
            "tenant_id": TENANT_A, "identifier": ident, "request_type": "delete",
            "reason": "用户申请删除", "created_by": "pytest",
        })
        assert r.status_code == 200
        rid = r.json()["request_id"]
        assert r.json()["status"] == "pending"

        r = get(f"/privacy/deletion/{rid}", tenant_id=TENANT_A)
        assert r.status_code == 200
        assert r.json()["identifier"] == ident
        assert "audit_log" in r.json()

        r = get("/privacy/deletion", tenant_id=TENANT_A, limit=50)
        assert r.status_code == 200
        assert rid in {x["request_id"] for x in r.json()["requests"]}
        assert r.json()["total"] >= 1

    def test_execute_requires_confirm(self):
        """未 confirm 不可执行（不可逆操作的安全闸门）→ 400。"""
        rid = post("/privacy/deletion", {
            "tenant_id": TENANT_A, "identifier": f"nc_{RUN}@test.local",
            "request_type": "delete",
        }).json()["request_id"]
        r = post(f"/privacy/deletion/{rid}/execute", {"confirm": False}, tenant_id=TENANT_A)
        assert r.status_code == 400
        # 仍为 pending，未被改动
        assert get(f"/privacy/deletion/{rid}", tenant_id=TENANT_A).json()["status"] == "pending"

    def test_execute_and_no_double_execute(self):
        """confirm 后执行完成；重复执行被拒（幂等保护）。"""
        rid = post("/privacy/deletion", {
            "tenant_id": TENANT_A, "identifier": f"ex_{RUN}@test.local",
            "request_type": "delete",
        }).json()["request_id"]
        r = post(f"/privacy/deletion/{rid}/execute", {"confirm": True}, tenant_id=TENANT_A)
        assert r.status_code == 200
        assert r.json()["status"] == "completed"

        # 工单状态落库为 completed，且生成审计
        detail = get(f"/privacy/deletion/{rid}", tenant_id=TENANT_A).json()
        assert detail["status"] == "completed"
        assert len(detail["audit_log"]) >= 1

        # 重复执行 → 400
        r = post(f"/privacy/deletion/{rid}/execute", {"confirm": True}, tenant_id=TENANT_A)
        assert r.status_code == 400

    def test_execute_missing_request_404(self):
        r = post("/privacy/deletion/99999999/execute", {"confirm": True}, tenant_id=TENANT_A)
        assert r.status_code == 404

    def test_get_missing_request_404(self):
        r = get("/privacy/deletion/99999999", tenant_id=TENANT_A)
        assert r.status_code == 404

    def test_deletion_tenant_isolation(self):
        """A 的工单 B 看不到，也无法跨租户执行。"""
        rid = post("/privacy/deletion", {
            "tenant_id": TENANT_A, "identifier": f"iso_{RUN}@test.local",
            "request_type": "delete",
        }).json()["request_id"]
        assert get(f"/privacy/deletion/{rid}", tenant_id=TENANT_B).status_code == 404
        assert post(f"/privacy/deletion/{rid}/execute", {"confirm": True},
                    tenant_id=TENANT_B).status_code == 404

    def test_suppress_then_check(self):
        """suppress 工单执行后，抑制名单校验应命中该 identifier。"""
        ident = f"sup_{RUN}_{uuid.uuid4().hex[:6]}@test.local"
        rid = post("/privacy/deletion", {
            "tenant_id": TENANT_A, "identifier": ident, "request_type": "suppress",
            "reason": "停止采集",
        }).json()["request_id"]
        post(f"/privacy/deletion/{rid}/execute", {"confirm": True}, tenant_id=TENANT_A)

        r = get("/privacy/suppression/check", tenant_id=TENANT_A, identifier=ident)
        assert r.status_code == 200
        assert r.json()["suppressed"] is True

        # 多租户：B 校验同一 identifier 不应命中
        r = get("/privacy/suppression/check", tenant_id=TENANT_B, identifier=ident)
        assert r.status_code == 200
        assert r.json()["suppressed"] is False

    def test_suppression_check_unknown_not_suppressed(self):
        r = get("/privacy/suppression/check", tenant_id=TENANT_A,
                identifier=f"never_{RUN}@test.local")
        assert r.status_code == 200
        assert r.json()["suppressed"] is False

    def test_suppression_check_requires_arg(self):
        """identifier 与 one_id 都不给 → 400。"""
        r = get("/privacy/suppression/check", tenant_id=TENANT_A)
        assert r.status_code == 400


# ════════════════════════════════════════════════════════════════════════
# 隐私审计日志
# ════════════════════════════════════════════════════════════════════════

class TestAuditLogs:
    def test_consent_change_writes_audit(self):
        """记录同意会落一条 consent_change 审计；按 operation_type 过滤可查到。"""
        cid = post("/privacy/consent/categories", {
            "tenant_id": TENANT_A, "category_name": f"审计_{RUN}_{uuid.uuid4().hex[:6]}",
        }).json()["category_id"]
        one_id = int(f"99030{int(time.time()) % 100000}")
        post("/privacy/consent", {
            "tenant_id": TENANT_A, "one_id": one_id, "category_id": cid, "granted": True,
        })

        r = post("/privacy/audit/logs", {
            "tenant_id": TENANT_A, "operation_type": "consent_change", "limit": 50,
        })
        assert r.status_code == 200
        assert r.json()["total"] >= 1
        assert all(x["operation_type"] == "consent_change" for x in r.json()["logs"])

    def test_audit_filter_by_request_id(self):
        rid = post("/privacy/deletion", {
            "tenant_id": TENANT_A, "identifier": f"aud_{RUN}@test.local",
            "request_type": "suppress",
        }).json()["request_id"]
        post(f"/privacy/deletion/{rid}/execute", {"confirm": True}, tenant_id=TENANT_A)

        r = post("/privacy/audit/logs", {"tenant_id": TENANT_A, "request_id": rid})
        assert r.status_code == 200
        logs = r.json()["logs"]
        assert len(logs) >= 1
        assert all(x["deletion_request_id"] == rid for x in logs)

    def test_audit_tenant_isolation(self):
        """B 租户用 A 的 request_id 查审计 → 查不到（租户隔离）。"""
        rid = post("/privacy/deletion", {
            "tenant_id": TENANT_A, "identifier": f"audiso_{RUN}@test.local",
            "request_type": "suppress",
        }).json()["request_id"]
        post(f"/privacy/deletion/{rid}/execute", {"confirm": True}, tenant_id=TENANT_A)

        r = post("/privacy/audit/logs", {"tenant_id": TENANT_B, "request_id": rid})
        assert r.status_code == 200
        assert r.json()["total"] == 0
