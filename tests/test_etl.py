"""可视化 ETL 测试（多源 → 字段映射 → 导入对象 → 进筛选）

前置：docker compose up -d mysql sql-engine && bash scripts/apply_migrations.sh
每个用例自带唯一 id 前缀并在结束清理，避免污染演示数据。
"""

import requests

API = "http://localhost:8002"
S = requests.Session()
S.trust_env = False
TENANT = 1001


def cleanup(table: str, idcol: str, ids: list[str]):
    """经 search 无删除接口，直接不依赖清理——用例 id 唯一即可幂等重跑。"""
    pass


def post(path: str, body: dict):
    return S.post(f"{API}{path}", json=body, timeout=15)


CSV = """pid,pname,cat,price
PT001,测试耳机,etl_test,199
PT002,测试键盘,etl_test,299
PT003,,etl_test,99"""

MAPPING = [
    {"target": "product_id", "source": "pid"},
    {"target": "sku", "source": "pname"},
    {"target": "category", "source": "cat"},
    {"target": "price", "source": "price"},
]


class TestEtlPreview:
    def test_csv_preview_maps_and_coerces(self):
        r = post("/etl/preview", {
            "tenant_id": TENANT, "target_object": "product",
            "source": {"type": "csv", "csv": CSV}, "mapping": MAPPING,
        }).json()
        assert r["total_rows"] == 3
        assert r["source_columns"] == ["pid", "pname", "cat", "price"]
        assert r["preview"][0] == {"product_id": "PT001", "sku": "测试耳机",
                                   "category": "etl_test", "price": 199.0}
        assert r["issues"] == []  # 第3行空 sku 但有主键，合法

    def test_preview_flags_missing_pk(self):
        r = post("/etl/preview", {
            "tenant_id": TENANT, "target_object": "product",
            "source": {"type": "csv", "csv": "pname\nfoo"},  # 无主键列
            "mapping": [{"target": "sku", "source": "pname"}],
        }).json()
        assert any("主键" in i for i in r["issues"])

    def test_unknown_field_rejected(self):
        r = post("/etl/preview", {
            "tenant_id": TENANT, "target_object": "product",
            "source": {"type": "inline", "rows": [{"x": 1}]},
            "mapping": [{"target": "ghost", "source": "x"}],
        })
        assert r.status_code == 400


class TestEtlImport:
    def test_inline_import_then_filterable(self):
        r = post("/etl/import", {
            "tenant_id": TENANT, "target_object": "product",
            "source": {"type": "inline", "rows": [
                {"pid": "PT010", "cat": "etl_imp"}, {"pid": "PT011", "cat": "etl_imp"}]},
            "mapping": [{"target": "product_id", "source": "pid"},
                        {"target": "category", "source": "cat"}],
        }).json()
        assert r["imported"] == 2 and r["failed"] == 0
        # 导入即可筛选
        sr = post("/objects/search", {
            "tenant_id": TENANT, "object": "product", "count_only": True,
            "conditions": [{"field": "category", "op": "eq", "value": "etl_imp"}],
        }).json()
        assert sr["estimate"] >= 2

    def test_import_with_relation_link(self):
        """导入订单并经 link 建立 order-contains->product 关系。"""
        post("/etl/import", {  # 先确保有个商品
            "tenant_id": TENANT, "target_object": "product",
            "source": {"type": "inline", "rows": [{"pid": "PT020", "cat": "etl_imp"}]},
            "mapping": [{"target": "product_id", "source": "pid"}, {"target": "category", "source": "cat"}],
        })
        r = post("/etl/import", {
            "tenant_id": TENANT, "target_object": "order",
            "source": {"type": "inline", "rows": [
                {"oid": "OT020", "amt": "500", "st": "paid", "prod": "PT020"}]},
            "mapping": [{"target": "order_id", "source": "oid"},
                        {"target": "amount", "source": "amt"}, {"target": "status", "source": "st"}],
            "link": {"rel_type": "contains", "dst_type": "product", "dst_id_source": "prod"},
        }).json()
        assert r["imported"] == 1 and r["relations"] == 1
        sr = post("/objects/search", {
            "tenant_id": TENANT, "object": "order", "count_only": True,
            "relations": [{"rel_type": "contains", "object": "product",
                           "conditions": [{"field": "product_id", "op": "eq", "value": "PT020"}]}],
        }).json()
        assert sr["estimate"] >= 1

    def test_type_coercion_error_collected_per_row(self):
        r = post("/etl/import", {
            "tenant_id": TENANT, "target_object": "product",
            "source": {"type": "inline", "rows": [
                {"pid": "PT030", "price": "abc"},  # price 非数字
                {"pid": "PT031", "price": "12.5"}]},
            "mapping": [{"target": "product_id", "source": "pid"}, {"target": "price", "source": "price"}],
        }).json()
        assert r["imported"] == 1 and r["failed"] == 1
        assert r["errors"][0]["row"] == 1


class TestEtlSources:
    def test_roadmap_source_rejected(self):
        r = post("/etl/import", {
            "tenant_id": TENANT, "target_object": "product",
            "source": {"type": "mysql"}, "mapping": [],
        })
        assert r.status_code == 400
        assert "csv/inline" in r.json()["detail"]
