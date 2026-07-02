import ReactMarkdown from 'react-markdown'
import { cn } from '@/shared/lib/cn'

// Безопасный рендер markdown (react-markdown не пропускает сырой HTML).
// Лёгкий набор: параграфы, списки, инлайн-код, код-блоки, ссылки, выделение.
export function Markdown({ children, className }: { children: string; className?: string }) {
  if (!children?.trim()) return null
  return (
    <div className={cn('text-[13px] leading-snug text-ink-2 [&>*+*]:mt-1.5', className)}>
      <ReactMarkdown
        components={{
          a: (p) => <a {...p} target="_blank" rel="noreferrer" className="text-accent hover:underline" />,
          code: (p) => <code {...p} className="rounded bg-surface-2 px-1 py-0.5 font-mono text-[0.9em] text-ink" />,
          pre: (p) => <pre {...p} className="overflow-x-auto rounded-md border border-border bg-surface-2 p-2.5 font-mono text-[12px] text-ink" />,
          ul: (p) => <ul {...p} className="list-disc pl-5" />,
          ol: (p) => <ol {...p} className="list-decimal pl-5" />,
          strong: (p) => <strong {...p} className="font-semibold text-ink" />,
          h1: (p) => <div {...p} className="font-semibold text-ink" />,
          h2: (p) => <div {...p} className="font-semibold text-ink" />,
          h3: (p) => <div {...p} className="font-semibold text-ink" />,
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  )
}
