"""可视化 ETL 内核（多数据源 → 字段映射 → 导入多对象 → 进入统一筛选）

设计：source(解析为行) → transform(字段映射 + 类型转换 + 常量/关系) → target(upsert 到对象表)。
- 数据源：csv(文本) / inline(已解析行)。mysql/kafka/api 作为适配器位预留(见 SOURCE_ADAPTERS)。
- 类型转换：按 OBJECT_REGISTRY 字段类型(int/float/json/json_array)强转，空串→跳过。
- 关系：可选 link 配置，导入行主键 →(rel_type)→ 目标对象，落 object_relations。
- 预览(dry_run)：只解析+映射前 N 行，不写库；导入：逐行 upsert，错误按行收集不中断。
"""

import csv
import io
import json
from typing import Any

from objects import OBJECT_REGISTRY, ObjectError, ObjectService

# 已实现的数据源；其余为路线图(UI 可展示但调用即报错，避免假装支持)
SOURCE_ADAPTERS = {"csv", "inline"}
ROADMAP_SOURCES = {"mysql", "kafka", "api"}


class EtlService:
    def __init__(self, objects: ObjectService | None = None):
        self.objects = objects or ObjectService()

    # ── 源解析 ────────────────────────────────────────────────────────────
    def read_rows(self, source: dict) -> list[dict]:
        stype = (source or {}).get("type", "inline")
        if stype == "inline":
            rows = source.get("rows") or []
            if not isinstance(rows, list):
                raise ObjectError("inline 源需要 rows 数组")
            return rows
        if stype == "csv":
            text = source.get("csv") or ""
            if not text.strip():
                raise ObjectError("csv 源为空")
            delim = source.get("delimiter") or ","
            reader = csv.DictReader(io.StringIO(text), delimiter=delim)
            return [dict(r) for r in reader]
        if stype in ROADMAP_SOURCES:
            raise ObjectError(f"数据源 {stype} 适配器尚未接入(路线图)，当前支持 csv/inline")
        raise ObjectError(f"未知数据源类型: {stype}")

    # ── 映射校验（配置错误快速失败，区别于按行的数据错误）──────────────
    def validate_mapping(self, target_object: str, mapping: list[dict]) -> None:
        meta = OBJECT_REGISTRY.get(target_object)
        if not meta:
            raise ObjectError(f"未知目标对象: {target_object}")
        fields = meta["fields"]
        for m in mapping or []:
            tgt = m.get("target")
            if tgt not in fields and tgt != "properties":
                raise ObjectError(f"对象 {target_object} 无字段: {tgt}")
            if m.get("const") is None and not m.get("source"):
                raise ObjectError(f"映射项 {tgt} 需指定 source 或 const")

    # ── 字段映射 + 类型转换 ──────────────────────────────────────────────
    def map_record(self, target_object: str, mapping: list[dict], row: dict) -> dict:
        """按 mapping 把源行转成目标对象记录。
        mapping 项：{target, source?} 取源列值；或 {target, const} 用常量。"""
        meta = OBJECT_REGISTRY.get(target_object)
        if not meta:
            raise ObjectError(f"未知目标对象: {target_object}")
        fields = meta["fields"]
        rec: dict[str, Any] = {}
        for m in mapping or []:
            tgt = m.get("target")
            if tgt not in fields and tgt != "properties":
                raise ObjectError(f"对象 {target_object} 无字段: {tgt}")
            # 注意：Pydantic model_dump 会带 const=None 键，需按值判断而非 key 是否存在
            if m.get("const") is not None:
                raw = m["const"]
            else:
                src = m.get("source")
                raw = row.get(src)
            val = self._coerce(fields.get(tgt, "str"), raw)
            if val is not None:
                rec[tgt] = val
        return rec

    def _coerce(self, ftype: str, raw: Any) -> Any:
        if raw is None:
            return None
        if isinstance(raw, str) and raw.strip() == "":
            return None
        try:
            if ftype == "int":
                return int(float(raw)) if not isinstance(raw, bool) else int(raw)
            if ftype == "float":
                return float(raw)
            if ftype in ("json", "json_array"):
                if isinstance(raw, (dict, list)):
                    return raw
                return json.loads(raw)
            return str(raw)
        except (ValueError, TypeError, json.JSONDecodeError):
            raise ObjectError(f"值 {raw!r} 无法转为 {ftype}")

    # ── 预览(dry-run) ────────────────────────────────────────────────────
    def preview(self, tenant_id: int, target_object: str, source: dict,
                mapping: list[dict], limit: int = 5) -> dict:
        self.validate_mapping(target_object, mapping)
        rows = self.read_rows(source)
        meta = OBJECT_REGISTRY[target_object]
        id_field = meta["id"]
        sample, issues = [], []
        for i, row in enumerate(rows[:limit]):
            try:
                rec = self.map_record(target_object, mapping, row)
                if id_field not in rec:
                    issues.append(f"第 {i + 1} 行缺少主键 {id_field}")
                sample.append(rec)
            except ObjectError as e:
                issues.append(f"第 {i + 1} 行: {e}")
        return {
            "target_object": target_object,
            "total_rows": len(rows),
            "source_columns": list(rows[0].keys()) if rows else [],
            "preview": sample,
            "issues": issues,
        }

    # ── 执行导入 ──────────────────────────────────────────────────────────
    def run_import(self, tenant_id: int, target_object: str, source: dict,
                   mapping: list[dict], link: dict | None = None, govern: bool = False) -> dict:
        self.validate_mapping(target_object, mapping)
        rows = self.read_rows(source)
        meta = OBJECT_REGISTRY[target_object]
        id_field = meta["id"]
        gov = None
        if govern:
            from governance import GovernanceService
            gov = GovernanceService(getattr(self.objects, "_executor", None))
        imported, relations, errors = 0, 0, []
        suppressed, blocked = 0, 0
        for i, row in enumerate(rows):
            try:
                rec = self.map_record(target_object, mapping, row)
                if id_field not in rec:
                    raise ObjectError(f"缺少主键 {id_field}")
                if gov is not None:
                    g = gov.apply(tenant_id, target_object, rec)
                    if g["status"] == "suppress":
                        suppressed += 1
                        continue
                    if g["status"] == "block":
                        blocked += 1
                        errors.append({"row": i + 1, "error": f"治理阻断：{g['reason']}"})
                        continue
                    rec = g["record"]
                self.objects.upsert_object(tenant_id, target_object, rec)
                imported += 1
                # 可选：为该行建立关系（导入行主键 → dst）
                if link:
                    dst_id = row.get(link.get("dst_id_source"))
                    if dst_id not in (None, ""):
                        self.objects.add_relation(
                            tenant_id, target_object, str(rec[id_field]),
                            link["rel_type"], link["dst_type"], str(dst_id))
                        relations += 1
            except (ObjectError, Exception) as e:  # noqa: BLE001
                errors.append({"row": i + 1, "error": str(e)})
        return {
            "target_object": target_object,
            "total_rows": len(rows),
            "imported": imported,
            "relations": relations,
            "suppressed": suppressed,
            "blocked": blocked,
            "governed": bool(gov is not None),
            "failed": len(errors),
            "errors": errors[:20],
        }
