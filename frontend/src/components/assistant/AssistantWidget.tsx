import { useCallback, useEffect, useRef, useState } from "react";
import { Sparkles, X, Send, ArrowRight, Trash2, Bell, BellOff } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { Spinner } from "../ui";
import { useLang } from "../../context/LangContext";
import { useTenant } from "../../context/TenantContext";
import { useAuth } from "../../context/AuthContext";
import { useAssistant } from "../../context/AssistantContext";
import { tracker } from "../../lib/tracker";
import {
  chatAssistant,
  listAssistantTasks,
  getAssistantHistory,
  clearAssistantHistory,
  type ChatMessage,
  type ChatStep,
  type ChatTask,
  type ChatCreated,
  type ProactiveSuggestion,
} from "../../api/assistant";

interface UiMessage {
  role: "user" | "assistant";
  content: string;
  steps?: ChatStep[];
  task?: ChatTask | null;
  agentName?: string;
  created?: ChatCreated | null;
  // 主动建议气泡（区别于普通对话）
  kind?: "proactive";
  suggestion?: ProactiveSuggestion;
  suggestionDone?: boolean;
}

export default function AssistantWidget() {
  const { tr } = useLang();
  const { tenant } = useTenant();
  const { user } = useAuth();
  const { open, setOpen } = useAssistant();
  const navigate = useNavigate();
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const [dnd, setDndState] = useState<boolean>(() => tracker.dnd);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const lastSuggestRef = useRef<string>("");

  // 按用户加载历史聊天记录；保留已弹出的主动建议气泡，避免被历史覆盖。
  useEffect(() => {
    if (!user) return;
    const key = `${user.id}:${tenant}`;
    if (loadedFor === key) return;
    getAssistantHistory(user.id, tenant)
      .then((hist) =>
        setMessages((prev) => {
          const keep = prev.filter((m) => m.kind === "proactive");
          return [...hist.map((m) => ({ role: m.role, content: m.content }) as UiMessage), ...keep];
        }),
      )
      .catch(() => {})
      .finally(() => setLoadedFor(key));
  }, [user, tenant, loadedFor]);

  // 订阅 tracker 的主动建议：到达即自动展开侧边栏并插入一条主动气泡。
  useEffect(() => {
    const off = tracker.onSuggestion((s) => {
      if (s.message && s.message === lastSuggestRef.current) return; // 去重连续相同建议
      lastSuggestRef.current = s.message || "";
      setMessages((prev) => [...prev, { role: "assistant", content: s.message, kind: "proactive", suggestion: s }]);
      setOpen(true);
    });
    return off;
  }, [setOpen]);

  function toggleDnd() {
    const v = !dnd;
    tracker.setDnd(v);
    setDndState(v);
  }

  async function clearHistory() {
    if (!user) return;
    if (!window.confirm(tr("清空与智能助手的聊天记录？", "Clear your assistant chat history?"))) return;
    try {
      await clearAssistantHistory(user.id, tenant);
    } catch {
      /* ignore */
    }
    setMessages([]);
  }

  // 新消息滚到底部
  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, loading]);

  // 轮询任务状态：最多 ~10 次，每 2s 更新某条 assistant 消息里的 task.status
  function pollTask(run_id: string) {
    let tries = 0;
    const timer = setInterval(async () => {
      tries += 1;
      try {
        const { tasks } = await listAssistantTasks();
        const found = tasks.find((t) => t.run_id === run_id);
        if (found) {
          setMessages((prev) =>
            prev.map((m) =>
              m.task && m.task.run_id === run_id ? { ...m, task: { ...m.task, status: found.status } } : m,
            ),
          );
          if (found.status === "success" || found.status === "failed") {
            clearInterval(timer);
            return;
          }
        }
      } catch {
        /* 忽略轮询错误 */
      }
      if (tries >= 10) clearInterval(timer);
    }, 2000);
  }

  const send = useCallback(
    async (text?: string) => {
      const content = (text ?? input).trim();
      if (!content || loading) return;
      const userMsg: UiMessage = { role: "user", content };
      const history = [...messages, userMsg];
      setMessages(history);
      setInput("");
      setLoading(true);
      try {
        const payload: ChatMessage[] = history
          .filter((m) => m.kind !== "proactive")
          .map((m) => ({ role: m.role, content: m.content }));
        const res = await chatAssistant(tenant, payload, user?.id);
        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            content: res.reply,
            steps: res.steps,
            task: res.task,
            agentName: res.agent_name,
            created: res.created,
          },
        ]);
        if (res.task?.run_id) pollTask(res.task.run_id);
        if (res.navigate?.path) navigate(res.navigate.path);
      } catch (e: any) {
        const errText = e?.response?.data?.detail || e?.message || tr("请求失败", "Request failed");
        setMessages((prev) => [...prev, { role: "assistant", content: String(errText) }]);
      } finally {
        setLoading(false);
      }
    },
    [input, loading, messages, tenant, user, navigate, tr],
  );

  // 主动建议的 action：打开页面 / 预填聊天框 / 仅忽略
  function runSuggestion(idx: number, accept: boolean) {
    setMessages((prev) => prev.map((m, i) => (i === idx ? { ...m, suggestionDone: true } : m)));
    if (!accept) return;
    const m = messages[idx];
    const act = m?.suggestion?.action;
    if (!act) return;
    if (act.type === "open_page" && act.path) {
      navigate(act.path);
    } else if (act.type === "prefill" && act.text) {
      setInput(act.text);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }

  return (
    <aside
      className={`fixed right-0 top-0 z-40 flex h-screen w-full flex-col border-l border-gray-200 bg-white shadow-xl transition-transform duration-300 ease-out lg:w-[400px] ${
        open ? "translate-x-0" : "translate-x-full"
      }`}
      aria-hidden={!open}
    >
      {/* 头部 */}
      <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
        <div className="flex items-center gap-2 text-sm font-semibold text-gray-900">
          <Sparkles className="h-4 w-4 text-brand-600" />
          {tr("智能助手", "Assistant")}
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={toggleDnd}
            className={`rounded-md p-1.5 ${dnd ? "text-gray-400 hover:bg-gray-100" : "text-brand-600 hover:bg-brand-50"}`}
            title={dnd ? tr("主动建议已关闭，点击开启", "Proactive tips off — click to enable") : tr("主动建议已开启，点击免打扰", "Proactive tips on — click for do-not-disturb")}
          >
            {dnd ? <BellOff className="h-4 w-4" /> : <Bell className="h-4 w-4" />}
          </button>
          {messages.length > 0 && (
            <button
              type="button"
              onClick={clearHistory}
              className="rounded-md p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-600"
              title={tr("清空记录", "Clear history")}
            >
              <Trash2 className="h-4 w-4" />
            </button>
          )}
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="rounded-md p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
            aria-label={tr("关闭", "Close")}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* 消息列表 */}
      <div ref={listRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
        {messages.length === 0 && !loading && (
          <div className="px-2 py-8 text-center text-sm text-gray-400">
            {tr(
              "问我任何关于数据底座的问题，或让我发布一个后台任务。",
              "Ask me anything about the data foundation, or have me publish a background task.",
            )}
          </div>
        )}
        {messages.map((m, i) =>
          m.kind === "proactive" ? (
            // 主动建议气泡：与普通对话区分，带 action 按钮
            <div key={i} className="flex justify-start">
              <div className="max-w-[90%] rounded-2xl border border-brand-200 bg-brand-50 px-3 py-2 text-sm text-gray-800">
                <div className="mb-1 inline-flex items-center gap-1 rounded-full bg-brand-100 px-2 py-0.5 text-[10px] font-semibold text-brand-700">
                  <Sparkles className="h-3 w-3" />
                  {m.suggestion?.title || tr("主动建议", "Suggestion")}
                </div>
                <div className="whitespace-pre-wrap break-words">{m.content}</div>
                {!m.suggestionDone && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {m.suggestion?.action && m.suggestion.action.type !== "none" && (
                      <button
                        type="button"
                        onClick={() => runSuggestion(i, true)}
                        className="inline-flex items-center gap-1 rounded-lg bg-brand-500 px-2.5 py-1 text-[12px] font-medium text-white hover:bg-brand-600"
                      >
                        {m.suggestion.action.type === "open_page" ? tr("打开页面", "Open page") : tr("好的", "Sure")}
                        <ArrowRight className="h-3 w-3" />
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => runSuggestion(i, false)}
                      className="inline-flex items-center rounded-lg bg-white px-2.5 py-1 text-[12px] font-medium text-gray-500 ring-1 ring-inset ring-gray-200 hover:bg-gray-50"
                    >
                      {tr("忽略", "Dismiss")}
                    </button>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div key={i} className={m.role === "user" ? "flex justify-end" : "flex justify-start"}>
              <div
                className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm ${
                  m.role === "user" ? "bg-brand-500 text-white" : "bg-gray-100 text-gray-800"
                }`}
              >
                {m.role === "assistant" && m.agentName && (
                  <div className="mb-1 inline-flex items-center rounded-full bg-brand-100 px-2 py-0.5 text-[10px] font-semibold text-brand-700">
                    {tr("智能体", "Agent")} · {m.agentName}
                  </div>
                )}
                <div className="whitespace-pre-wrap break-words">{m.content}</div>
                {m.created && (
                  <Link
                    to={m.created.path}
                    className="mt-2 inline-flex items-center gap-1 rounded-lg bg-brand-50 px-2 py-1 text-[11px] font-medium text-brand-700 ring-1 ring-inset ring-brand-200 hover:bg-brand-100"
                  >
                    {m.created.kind === "dashboard" ? tr("打开看板", "Open dashboard") : tr("打开分析", "Open analytics")} ·{" "}
                    {m.created.title}
                    <ArrowRight className="h-3 w-3" />
                  </Link>
                )}
                {m.steps && m.steps.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {m.steps.map((s, j) => (
                      <span
                        key={j}
                        className="inline-flex items-center rounded-full bg-white/70 px-2 py-0.5 text-[11px] font-medium text-gray-500 ring-1 ring-inset ring-gray-200"
                        title={s.summary}
                      >
                        🔧 {s.tool}
                      </span>
                    ))}
                  </div>
                )}
                {m.task && (
                  <div className="mt-2 inline-flex flex-wrap items-center gap-1 rounded-lg bg-amber-50 px-2 py-1 text-[11px] font-medium text-amber-700 ring-1 ring-inset ring-amber-200">
                    {tr("任务已发布", "Task published")} · {m.task.task_name} · {m.task.run_id} · {m.task.status}
                  </div>
                )}
              </div>
            </div>
          ),
        )}
        {loading && (
          <div className="flex justify-start">
            <div className="flex items-center gap-2 rounded-2xl bg-gray-100 px-3 py-2 text-sm text-gray-500">
              <Spinner /> {tr("思考中…", "Thinking…")}
            </div>
          </div>
        )}
      </div>

      {/* 输入区 */}
      <div className="border-t border-gray-200 p-3">
        <div className="flex items-end gap-2">
          <textarea
            ref={inputRef}
            rows={1}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            placeholder={tr("输入消息…", "Type a message…")}
            className="max-h-32 min-h-[38px] flex-1 resize-none rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-400 focus:outline-none"
          />
          <button
            type="button"
            onClick={() => send()}
            disabled={loading || !input.trim()}
            className="inline-flex h-[38px] items-center justify-center gap-1 rounded-lg bg-brand-500 px-3 text-sm font-medium text-white transition-colors hover:bg-brand-600 disabled:cursor-not-allowed disabled:bg-brand-300"
          >
            <Send className="h-4 w-4" />
            {tr("发送", "Send")}
          </button>
        </div>
      </div>
    </aside>
  );
}
