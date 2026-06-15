// 主动式埋点 Copilot：浏览器行为采集器（前端单例）。
// 缓冲行为事件 → 命中触发点（切页 / idle 超时 / 攒够 N 条 / 强信号）批量 POST /observe，
// 后端返回主动建议时通过订阅回调交给侧边栏。仅采集元信息（路径/动作/计数/错误码），不采集敏感字段。
import { observeBehavior, type BehaviorEvent, type ProactiveSuggestion } from "../api/assistant";

const SESSION_KEY = "cdp_session_id";
const DND_KEY = "cdp_assistant_dnd";

function genSession(): string {
  try {
    const ex = sessionStorage.getItem(SESSION_KEY);
    if (ex) return ex;
    const id = `s_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    sessionStorage.setItem(SESSION_KEY, id);
    return id;
  } catch {
    return `s_${Date.now()}`;
  }
}

type SuggestionListener = (s: ProactiveSuggestion) => void;
type BehaviorType = BehaviorEvent["type"];

class Tracker {
  private sessionId = genSession();
  private tenant = 0;
  private userId: number | undefined;
  private buffer: BehaviorEvent[] = [];
  private page: { path: string; name?: string } = { path: "/" };
  private listeners: SuggestionListener[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private idledFired = false;
  private lastActivity = 0;
  private pageEnter = Date.now();
  private recentPaths: { path: string; t: number }[] = []; // repeat（反复横跳）检测

  private readonly MAX_BUFFER = 50;
  private readonly FLUSH_AT = 10; // 攒够 N 条触发上报
  private readonly DEBOUNCE_MS = 8000; // 普通事件去抖
  private readonly IDLE_MS = 20000; // 停留无操作阈值

  configure(tenant: number, userId?: number) {
    this.tenant = tenant;
    this.userId = userId;
  }

  get dnd(): boolean {
    try {
      return localStorage.getItem(DND_KEY) === "1";
    } catch {
      return false;
    }
  }
  setDnd(v: boolean) {
    try {
      localStorage.setItem(DND_KEY, v ? "1" : "0");
    } catch {
      /* ignore */
    }
  }

  onSuggestion(cb: SuggestionListener): () => void {
    this.listeners.push(cb);
    return () => {
      this.listeners = this.listeners.filter((x) => x !== cb);
    };
  }

  /** 记一条行为事件并按触发规则决定是否上报。 */
  track(type: BehaviorType, payload?: Record<string, any>) {
    const ev: BehaviorEvent = { type, ts: Date.now(), path: this.page.path, name: this.page.name, payload };
    this.buffer.push(ev);
    if (this.buffer.length > this.MAX_BUFFER) this.buffer.splice(0, this.buffer.length - this.MAX_BUFFER);
    if (type !== "idle") this.noteActivity();

    const strong = type === "error" || type === "empty_state" || type === "repeat" || type === "idle";
    if (strong) this.flush(`signal:${type}`);
    else if (this.buffer.length >= this.FLUSH_AT) this.flush("buffer");
    else this.scheduleFlush();
  }

  /** 路由变化：离开上一页时带上停留时长，并做 repeat 检测。 */
  pageView(path: string, name?: string) {
    if (path === this.page.path) return;
    const now = Date.now();
    const dwell = now - this.pageEnter;
    this.recentPaths = this.recentPaths.filter((r) => now - r.t < 60000);
    this.recentPaths.push({ path, t: now });
    const visits = this.recentPaths.filter((r) => r.path === path).length;
    this.page = { path, name };
    this.pageEnter = now;
    this.track("page_view", { name, prev_dwell_ms: dwell });
    if (visits >= 3) this.track("repeat", { path, count: visits });
  }

  /** 真实用户活动（鼠标/键盘/点击）：重置 idle 计时。内部限频，避免每次 mousemove 都重置。 */
  noteActivity() {
    const now = Date.now();
    this.idledFired = false;
    if (this.idleTimer && now - this.lastActivity < 1500) return;
    this.lastActivity = now;
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => {
      if (this.idledFired) return;
      this.idledFired = true;
      this.track("idle", { dwell_ms: Date.now() - this.pageEnter });
    }, this.IDLE_MS);
  }

  private scheduleFlush() {
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      this.flush("timer");
    }, this.DEBOUNCE_MS);
  }

  async flush(_reason: string) {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    if (!this.buffer.length || !this.tenant) return;
    const batch = this.buffer.splice(0, this.buffer.length);
    try {
      const { suggestion } = await observeBehavior({
        tenant_id: this.tenant,
        user_id: this.userId,
        session_id: this.sessionId,
        page: this.page,
        events: batch,
      });
      if (suggestion && !this.dnd) this.listeners.forEach((cb) => cb(suggestion));
    } catch {
      /* 上报失败静默，行为不阻塞页面 */
    }
  }
}

export const tracker = new Tracker();
