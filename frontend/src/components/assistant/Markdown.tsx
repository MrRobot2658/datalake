import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

// 聊天气泡内的 Markdown 渲染：紧凑排版，按需覆盖元素样式。
// react-markdown 默认不渲染原始 HTML，安全（无需手动转义）。
export default function Markdown({ children }: { children: string }) {
  return (
    <div className="space-y-2 text-sm leading-relaxed break-words">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          p: ({ children }) => <p className="whitespace-pre-wrap">{children}</p>,
          a: ({ children, href }) => (
            <a href={href} target="_blank" rel="noreferrer" className="text-brand-600 underline underline-offset-2 hover:text-brand-700">
              {children}
            </a>
          ),
          strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
          ul: ({ children }) => <ul className="list-disc space-y-1 pl-5">{children}</ul>,
          ol: ({ children }) => <ol className="list-decimal space-y-1 pl-5">{children}</ol>,
          li: ({ children }) => <li className="marker:text-gray-400">{children}</li>,
          h1: ({ children }) => <h1 className="mt-1 text-[15px] font-semibold">{children}</h1>,
          h2: ({ children }) => <h2 className="mt-1 text-[14px] font-semibold">{children}</h2>,
          h3: ({ children }) => <h3 className="mt-1 text-[13px] font-semibold">{children}</h3>,
          blockquote: ({ children }) => (
            <blockquote className="border-l-2 border-gray-300 pl-3 text-gray-600">{children}</blockquote>
          ),
          hr: () => <hr className="border-gray-200" />,
          code: ({ className, children }) => {
            const block = /language-/.test(className || "");
            if (block) {
              return (
                <code className={`block overflow-x-auto rounded-lg bg-gray-900 p-2.5 font-mono text-[12px] text-gray-100 ${className || ""}`}>
                  {children}
                </code>
              );
            }
            return <code className="rounded bg-black/10 px-1 py-0.5 font-mono text-[12px]">{children}</code>;
          },
          pre: ({ children }) => <pre className="overflow-x-auto">{children}</pre>,
          table: ({ children }) => (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-[12px]">{children}</table>
            </div>
          ),
          th: ({ children }) => <th className="border border-gray-200 bg-gray-50 px-2 py-1 text-left font-semibold">{children}</th>,
          td: ({ children }) => <td className="border border-gray-200 px-2 py-1 align-top">{children}</td>,
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
