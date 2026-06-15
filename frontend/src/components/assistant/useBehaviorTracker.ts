// 主动式埋点 Copilot：把 tracker 接到路由 / 活动 / 点击。挂在 AssistantShell（在 Router+Auth+Tenant 之内）。
import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import { useTenant } from "../../context/TenantContext";
import { tracker } from "../../lib/tracker";

export function useBehaviorTracker() {
  const { user } = useAuth();
  const { tenant } = useTenant();
  const loc = useLocation();

  useEffect(() => {
    tracker.configure(tenant, user?.id);
  }, [tenant, user]);

  // 路由变化 → page_view（页面名由后端按路由表解析）
  useEffect(() => {
    if (!user) return;
    tracker.pageView(loc.pathname);
  }, [loc.pathname, user]);

  // 活动监听（重置 idle）+ 关键元素点击（data-track）
  useEffect(() => {
    if (!user) return;
    const onActivity = () => tracker.noteActivity();
    const onClick = (e: MouseEvent) => {
      const el = (e.target as HTMLElement)?.closest?.("[data-track]");
      if (el) tracker.track("click", { track_id: el.getAttribute("data-track") });
      else tracker.noteActivity();
    };
    window.addEventListener("mousemove", onActivity, { passive: true });
    window.addEventListener("keydown", onActivity);
    window.addEventListener("click", onClick, true);
    tracker.noteActivity();
    return () => {
      window.removeEventListener("mousemove", onActivity);
      window.removeEventListener("keydown", onActivity);
      window.removeEventListener("click", onClick, true);
    };
  }, [user]);
}
