#!/usr/bin/env python3
"""
通过 Kafka 发送用户事件，走完整链路：Kafka → ID-Mapping 服务 → Redis + MySQL

用法:
  python3 simulate_channels.py --tenant 1001
  python3 simulate_channels.py --tenant 1002
  python3 simulate_channels.py --all
"""

import argparse
import json
import sys
import time

try:
    from kafka import KafkaProducer
except ImportError:
    print("请先安装: pip install kafka-python-ng")
    sys.exit(1)

BOOTSTRAP = "localhost:9094"

SCENARIOS = {
    1001: {
        "name": "品牌A（大租户）",
        "topic": "tenant-1001-events",
        "user": {
            "wechat_openid": "oXxx_kafka_user_001",
            "wechat_unionid": "union_kafka_abc001",
            "phone": "13900002222",
            "wework_extid": "wmKafkaExt001",
            "email": "kafka_user@brand-a.com",
            "device": "device_kafka_ios_001",
            "web_visitor_id": "web_kafka_visitor_001",
            "wechat_mp_openid": "mpo_kafka_001",
            "wechat_channels_id": "ch_kafka_001",
            "xiaohongshu_id": "xhs_kafka_001",
            "douyin_id": "dy_kafka_001",
        },
        "steps": [
            ("Step1 微信小程序匿名访问", {
                "channel_type": "wechat_openid",
                "channel_key": "wechat_openid",
                "event_type": "page_view",
                "link_keys": {},
                "properties": {"page": "home", "order_count": 1, "amount": 99},
            }),
            ("Step2 微信授权登录 (openid+unionid)", {
                "channel_type": "wechat_openid",
                "channel_key": "wechat_openid",
                "event_type": "login",
                "link_keys": {"wechat_unionid": "wechat_unionid"},
                "properties": {"login_method": "wechat_auth", "order_count": 2, "amount": 299},
            }),
            ("Step3 手机号绑定 (phone+unionid)", {
                "channel_type": "phone",
                "channel_key": "phone",
                "event_type": "register",
                "link_keys": {"wechat_unionid": "wechat_unionid"},
                "properties": {"register_source": "mini_program", "order_count": 3, "amount": 1500},
            }),
            ("Step4 企微添加好友 (wework+phone)", {
                "channel_type": "wework_extid",
                "channel_key": "wework_extid",
                "event_type": "add_friend",
                "link_keys": {"phone": "phone"},
                "properties": {"wework_tag": "VIP", "order_count": 5, "amount": 8800},
            }),
            ("Step5 App设备活跃 (device+email+phone)", {
                "channel_type": "device",
                "channel_key": "device",
                "event_type": "app_launch",
                "link_keys": {"email": "email", "phone": "phone"},
                "properties": {"app_version": "3.2.1", "order_count": 8, "amount": 15000},
            }),
            ("Step6 公众号关注 (mp_openid+unionid)", {
                "channel_type": "wechat_mp_openid",
                "channel_key": "wechat_mp_openid",
                "event_type": "subscribe_mp",
                "link_keys": {"wechat_unionid": "wechat_unionid"},
                "properties": {"mp_source": "扫码关注", "mp_scene": "线下海报", "interest": "新品发布"},
            }),
            ("Step7 视频号看直播 (channels+unionid)", {
                "channel_type": "wechat_channels_id",
                "channel_key": "wechat_channels_id",
                "event_type": "watch_live",
                "link_keys": {"wechat_unionid": "wechat_unionid"},
                "properties": {"live_room": "618品牌直播间", "watch_seconds": 1830, "interest": "直播带货"},
            }),
            ("Step8 官网埋点浏览 (web+phone)", {
                "channel_type": "web_visitor_id",
                "channel_key": "web_visitor_id",
                "event_type": "browse_official_site",
                "link_keys": {"phone": "phone"},
                "properties": {"page": "/products/flagship", "utm_source": "baidu", "stay_seconds": 95, "interest": "旗舰机型"},
            }),
            ("Step9 小红书种草点击 (xhs+phone)", {
                "channel_type": "xiaohongshu_id",
                "channel_key": "xiaohongshu_id",
                "event_type": "content_engage",
                "link_keys": {"phone": "phone"},
                "properties": {"note_id": "xhs_note_8821", "action": "收藏+点赞", "campaign": "种草测评", "interest": "口碑内容"},
            }),
            ("Step10 抖音广告点击 (douyin+phone)", {
                "channel_type": "douyin_id",
                "channel_key": "douyin_id",
                "event_type": "ad_click",
                "link_keys": {"phone": "phone"},
                "properties": {"ad_id": "dy_ad_5566", "campaign": "618大促", "action": "点击落地页", "order_count": 9, "amount": 18800},
            }),
            ("Step11 冲突合并 (另一openid绑定同一手机)", {
                "channel_type": "wechat_openid",
                "channel_id": "oXxx_kafka_user_002_conflict",
                "event_type": "bind_phone",
                "link_keys": {"phone": "phone"},
                "properties": {"bind_source": "another_mini_program"},
            }),
        ],
    },
    1002: {
        "name": "品牌B（小租户）",
        "topic": "tenant-1002-events",
        "user": {
            "wechat_openid": "oBbb_kafka_user_001",
            "phone": "13800003333",
            "email": "kafka_user@brand-b.com",
            "device": "device_kafka_android_002",
            "wechat_mp_openid": "mpo_kafka_b001",
            "xiaohongshu_id": "xhs_kafka_b001",
            "douyin_id": "dy_kafka_b001",
        },
        "steps": [
            ("Step1 抖音广告引流 (douyin匿名)", {
                "channel_type": "douyin_id",
                "channel_key": "douyin_id",
                "event_type": "ad_click",
                "link_keys": {},
                "properties": {"ad_id": "dy_ad_b001", "campaign": "新客拉新", "interest": "入门款"},
            }),
            ("Step2 H5页面访问 (openid)", {
                "channel_type": "wechat_openid",
                "channel_key": "wechat_openid",
                "event_type": "page_view",
                "link_keys": {},
                "properties": {"page": "product_list", "order_count": 0, "amount": 0},
            }),
            ("Step3 手机号登录 (phone+openid)", {
                "channel_type": "phone",
                "channel_key": "phone",
                "event_type": "login",
                "link_keys": {"wechat_openid": "wechat_openid"},
                "properties": {"login_method": "sms", "order_count": 1, "amount": 199},
            }),
            ("Step4 邮箱订阅 (email+phone)", {
                "channel_type": "email",
                "channel_key": "email",
                "event_type": "subscribe",
                "link_keys": {"phone": "phone"},
                "properties": {"newsletter": True, "order_count": 2, "amount": 599},
            }),
            ("Step5 App活跃 (device+email)", {
                "channel_type": "device",
                "channel_key": "device",
                "event_type": "app_launch",
                "link_keys": {"email": "email"},
                "properties": {"app_version": "2.1.0", "order_count": 4, "amount": 3200},
            }),
            ("Step6 小红书种草 (xhs+phone)", {
                "channel_type": "xiaohongshu_id",
                "channel_key": "xiaohongshu_id",
                "event_type": "content_engage",
                "link_keys": {"phone": "phone"},
                "properties": {"note_id": "xhs_note_b556", "action": "点赞", "campaign": "口碑种草", "interest": "性价比"},
            }),
            ("Step7 公众号关注 (mp_openid+openid)", {
                "channel_type": "wechat_mp_openid",
                "channel_key": "wechat_mp_openid",
                "event_type": "subscribe_mp",
                "link_keys": {"phone": "phone"},
                "properties": {"mp_source": "图文底部", "mp_scene": "活动推文", "interest": "优惠券"},
            }),
            ("Step8 抖音回流转化 (douyin+phone, 合并匿名首触)", {
                "channel_type": "douyin_id",
                "channel_key": "douyin_id",
                "event_type": "ad_convert",
                "link_keys": {"phone": "phone"},
                "properties": {"ad_id": "dy_ad_b001", "action": "落地页留资", "order_count": 5, "amount": 4100},
            }),
        ],
    },
}


def resolve_link_keys(user: dict, link_spec: dict) -> dict:
    resolved = {}
    for key, ref in link_spec.items():
        if ref in user:
            resolved[key] = user[ref]
        else:
            resolved[key] = ref
    return resolved


def send(producer, topic, tenant_id, event):
    future = producer.send(topic, key=str(tenant_id).encode(), value=event)
    future.get(timeout=10)
    print(
        f"  → Kafka [{event['channel_type']}] {event['channel_id']} "
        f"| link_keys={list(event.get('link_keys', {}).keys())}"
    )


def run_tenant(producer, tenant_id: int, interval: float = 2.0):
    scenario = SCENARIOS[tenant_id]
    user = scenario["user"]
    topic = scenario["topic"]

    print("=" * 60)
    print(f"Kafka 多渠道合并模拟 — {scenario['name']}")
    print(f"租户: {tenant_id} | Topic: {topic}")
    print("=" * 60)

    for desc, step in scenario["steps"]:
        print(f"\n[{desc}]")
        channel_id = step.get("channel_id") or user[step["channel_key"]]
        event = {
            "tenant_id": tenant_id,
            "channel_type": step["channel_type"],
            "channel_id": channel_id,
            "event_type": step["event_type"],
            "link_keys": resolve_link_keys(user, step.get("link_keys", {})),
            "properties": step.get("properties", {}),
        }
        send(producer, topic, tenant_id, event)
        time.sleep(interval)

    print(f"\n✓ 租户 {tenant_id} 事件已全部发送到 Kafka topic: {topic}")


def main():
    parser = argparse.ArgumentParser(description="Kafka 多渠道用户合并模拟")
    parser.add_argument("--tenant", type=int, choices=[1001, 1002], help="指定租户 ID")
    parser.add_argument("--all", action="store_true", help="运行全部租户模拟")
    parser.add_argument("--bootstrap", default=BOOTSTRAP, help="Kafka bootstrap servers")
    parser.add_argument("--interval", type=float, default=2.0, help="事件间隔秒数")
    args = parser.parse_args()

    if not args.tenant and not args.all:
        parser.error("请指定 --tenant 1001/1002 或 --all")

    producer = KafkaProducer(
        bootstrap_servers=args.bootstrap,
        value_serializer=lambda v: json.dumps(v, ensure_ascii=False).encode("utf-8"),
    )

    tenants = [1001, 1002] if args.all else [args.tenant]
    for tenant_id in tenants:
        run_tenant(producer, tenant_id, args.interval)
        if len(tenants) > 1 and tenant_id != tenants[-1]:
            print("\n" + "-" * 60 + "\n")

    producer.flush()
    producer.close()

    print("\n" + "=" * 60)
    print("Kafka 模拟完成！查看结果：")
    for tenant_id in tenants:
        user = SCENARIOS[tenant_id]["user"]
        print(f"  租户 {tenant_id}: bash scripts/query_status.sh {tenant_id}")
        if "phone" in user:
            print(f"    curl http://localhost:8001/mapping/{tenant_id}/phone/{user['phone']}")
    print(f"  Kafka UI: http://localhost:8083")
    print("=" * 60)


if __name__ == "__main__":
    main()
