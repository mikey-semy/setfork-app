import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { cn } from '@/shared/lib/cn'
import { SmartImage } from './SmartImage'
import { remarkIssueRefs } from './remark-issue-refs'

// Безопасный рендер markdown (react-markdown не пропускает сырой HTML) + GFM
// (таск-листы, таблицы, strikethrough, автоссылки) + картинки. refBase — префикс
// для кросс-ссылок `#N` на issue (напр. /owner/slug/issues); задаётся в issue/suggestion.
export function Markdown({ children, className, refBase }: { children: string; className?: string; refBase?: string }) {
  if (!children?.trim()) return null
  return (
    <div className={cn('text-[13px] leading-snug text-ink-2 [&>*+*]:mt-1.5 [&_li:has(input)]:list-none', className)}>
      <ReactMarkdown
        remarkPlugins={refBase ? [remarkGfm, remarkIssueRefs(refBase)] : [remarkGfm]}
        components={{
          a: (p) => <a {...p} target="_blank" rel="noreferrer" className="text-accent hover:underline" />,
          code: (p) => <code {...p} className="rounded bg-surface-2 px-1 py-0.5 font-mono text-[0.9em] text-ink" />,
          pre: (p) => <pre {...p} className="overflow-x-auto rounded-md border border-border bg-surface-2 p-2.5 font-mono text-[12px] text-ink" />,
          ul: (p) => <ul {...p} className="list-disc pl-5" />,
          ol: (p) => <ol {...p} className="list-decimal pl-5" />,
          strong: (p) => <strong {...p} className="font-semibold text-ink" />,
          del: (p) => <del {...p} className="text-muted" />,
          h1: (p) => <div {...p} className="text-[15px] font-semibold text-ink" />,
          h2: (p) => <div {...p} className="text-[14px] font-semibold text-ink" />,
          h3: (p) => <div {...p} className="font-semibold text-ink" />,
          blockquote: (p) => <blockquote {...p} className="border-l-2 border-border pl-3 text-muted" />,
          input: (p) => <input {...p} disabled className="mr-1.5 align-middle accent-accent" />,
          img: (p) => (
            <SmartImage src={typeof p.src === 'string' ? p.src : ''} alt={p.alt || ''} className="my-1.5 max-w-full rounded-md border border-border" />
          ),
          table: (p) => (
            <div className="overflow-x-auto">
              <table {...p} className="w-full border-collapse text-[12.5px]" />
            </div>
          ),
          th: (p) => <th {...p} className="border border-border px-2 py-1 text-left font-semibold text-ink" />,
          td: (p) => <td {...p} className="border border-border px-2 py-1" />,
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  )
}
