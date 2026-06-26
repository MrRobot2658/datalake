"""入库前治理钩子：抑制名单 + PII 处理（hash/mask/block/drop）。

在 ETL 导入（etl.run_import）逐行 upsert 前调用，对单条记录做合规处理：
  - 抑制名单：记录的标识值（手机/邮箱/渠道/设备等 PII 标识字段）命中 suppression_list → 跳过（status=suppress）。
  - PII：字段按默认规则（privacy_api._match_pii）+ 自定义 pii_rules（is_active）确定动作：
        hash/encrypt → 不可逆哈希；mask → 打码；drop → 删字段；block → 拒收该行；allow/其它 → 保留。
  抑制检查用**原始值**（先于哈希）。全部可降级：表缺失/异常时放行（status=import，原样）。

仅当导入请求显式 govern=True 时启用（默认关，避免改动既有导入/演示数据行为）。
"""
from __future__ import annotations

import hashlib
import json
from contextlib import contextmanager

import pymysql

from executor import MysqlOlapExecutor
from privacy_api import _match_pii  # 默认 PII 字段名→{category, action} 映射

# 视为「身份标识」的 PII 分类（用于抑制名单匹配）
_ID_CATEGORIES = {"电话号码", "电子邮箱", "渠道标识", "设备标识", "身份证号"}


def _hash(v) -> str:
    return "sha256:" + hashlib.sha256(str(v).encode("utf-8")).hexdigest()[:24]


def _mask(v) -> str:
    s = str(v)
    if len(s) <= 2:
        return "*" * len(s)
    keep = 1 if len(s) <= 6 else 2
    return s[:keep] + "*" * max(1, len(s) - keep * 2) + s[-keep:]


class GovernanceService:
    def __init__(self, executor: MysqlOlapExecutor | None = None):
        self.executor = executor or MysqlOlapExecutor()
        self.config = self.executor.config

    @contextmanager
    def _conn(self):
        conn = pymysql.connect(**self.config, autocommit=True)
        try:
            yield conn
        finally:
            conn.close()

    def _custom_actions(self, tenant_id: int, target_object: str) -> dict[str, str]:
        """自定义 pii_rules：field_name(小写) -> action。空对象列表=作用于全部对象。"""
        out: dict[str, str] = {}
        try:
            with self._conn() as conn, conn.cursor() as cur:
                cur.execute(
                    "SELECT field_name, action, target_objects FROM pii_rules "
                    "WHERE tenant_id=%s AND is_active=1", (tenant_id,))
                for r in cur.fetchall():
                    tos = r.get("target_objects")
                    if tos:
                        try:
                            lst = json.loads(tos) if isinstance(tos, str) else tos
                            if lst and target_object not in lst:
                                continue
                        except (json.JSONDecodeError, TypeError):
                            pass
                    if r.get("field_name") and r.get("action"):
                        out[str(r["field_name"]).lower()] = r["action"]
        except Exception:  # noqa: BLE001
            pass
        return out

    def _suppressed(self, tenant_id: int, values: list) -> bool:
        vals = list({str(v) for v in values if v not in (None, "")})
        if not vals:
            return False
        try:
            ph = ",".join(["%s"] * len(vals))
            with self._conn() as conn, conn.cursor() as cur:
                cur.execute(
                    f"SELECT 1 FROM suppression_list WHERE tenant_id=%s AND identifier IN ({ph}) LIMIT 1",
                    (tenant_id, *vals))
                return cur.fetchone() is not None
        except Exception:  # noqa: BLE001
            return False

    def _action_for(self, field: str, custom: dict[str, str]) -> str | None:
        f = field.lower()
        if f in custom:
            return custom[f]
        m = _match_pii(field)
        return m.get("action") if m else None

    def apply(self, tenant_id: int, target_object: str, record: dict) -> dict:
        """返回 {status: 'import'|'suppress'|'block', record, reason}。"""
        custom = self._custom_actions(tenant_id, target_object)
        # 1) 抑制名单（用原始标识值，先于哈希）
        ids = [v for k, v in record.items()
               if (m := _match_pii(k)) and m.get("category") in _ID_CATEGORIES]
        if self._suppressed(tenant_id, ids):
            return {"status": "suppress", "record": record, "reason": "命中抑制名单"}
        # 2) PII 处理
        out = dict(record)
        for k in list(out.keys()):
            act = self._action_for(k, custom)
            if not act or act in ("allow", "keep"):
                continue
            v = out[k]
            if v in (None, ""):
                continue
            if act == "block":
                return {"status": "block", "record": record, "reason": f"字段 {k} 命中阻断规则"}
            if act in ("hash", "encrypt"):
                out[k] = _hash(v)
            elif act == "mask":
                out[k] = _mask(v)
            elif act == "drop":
                out.pop(k, None)
        return {"status": "import", "record": out, "reason": None}
