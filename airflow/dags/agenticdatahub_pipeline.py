"""AgenticDataHub 通用 pipeline DAG。

sql-engine 在「运行 Pipeline」时通过 Airflow REST API 触发本 DAG，并把 pipeline 信息
（名称 / 租户 / 节点数）放进 dag_run.conf。本 DAG 不需要预先为每个 pipeline 建 DAG，
而是用一个参数化 DAG 承载所有 pipeline 运行 —— 简单可靠，便于 dev 演示。
"""
from datetime import datetime

from airflow import DAG
from airflow.operators.bash import BashOperator

with DAG(
    dag_id="agenticdatahub_pipeline",
    description="AgenticDataHub 可视化编排 Pipelines 的通用执行 DAG（参数化）",
    schedule=None,                    # 仅手动 / API 触发
    start_date=datetime(2024, 1, 1),
    catchup=False,
    is_paused_upon_creation=False,    # 创建即启用，API 触发后能直接被调度
    tags=["agenticdatahub", "pipeline"],
) as dag:
    BashOperator(
        task_id="run_pipeline",
        bash_command=(
            'echo "[AgenticDataHub] run pipeline"; '
            'echo "tenant   = {{ dag_run.conf.get(\'tenant_id\', \'-\') }}"; '
            'echo "pipeline = {{ dag_run.conf.get(\'pipeline_name\', \'-\') }}"; '
            'echo "pipe_id  = {{ dag_run.conf.get(\'pipeline_id\', \'-\') }}"; '
            'echo "nodes    = {{ dag_run.conf.get(\'nodes\', 0) }}"; '
            'echo "edges    = {{ dag_run.conf.get(\'edges\', 0) }}"; '
            'echo "done"'
        ),
    )
