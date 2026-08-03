import { isValidElement, type ReactNode } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { cn } from '@/shared/lib/cn'
import { SmartImage } from './SmartImage'
import { CodeCard } from './CodeCard'
import { codeLabel } from '@/shared/lib/detect-code-lang'
import { remarkIssueRefs } from './remark-issue-refs'

/** Текст код-блока и его язык из children элемента pre (react-markdown кладёт туда <code className="language-x">). */
function codeOf(children: ReactNode): { code: string; name?: string } | null {
  const child = Array.isArray(children) ? children[0] : children
  if (!isValidElement(child)) return null
  const props = child.props as { className?: string; children?: ReactNode }
  const raw = props.children
  const code = typeof raw === 'string' ? raw : Array.isArray(raw) && raw.every((x) => typeof x === 'string') ? raw.join('') : ''
  if (!code) return null
  return { code, name: /language-([\w-]+)/.exec(props.className ?? '')?.[1] }
}

// Безопасный рендер markdown (react-markdown не пропускает сырой HTML) + GFM
// (таск-листы, таблицы, strikethrough, автоссылки) + картинки. refBase — префикс
// для кросс-ссылок `#N` на issue (напр. /owner/slug/issues); задаётся в issue/suggestion.
// Код-блоки — ВСЕГДА карточкой CodeCard: подпись языка, копирование, номера строк,
// подсветка, перенос вместо горизонтального скролла. Раньше карточка включалась флагом
// и жила только в чатах гномов, а в описаниях шагов, задачах и релизах код рендерился
// голым <pre> — без копирования, языка и подсветки (жалоба владельца 03.08.2026). Флага
// больше нет: одна форма кода на весь продукт. Язык берём из ограды, а если её нет —
// опознаём по синтаксису (detect-code-lang): в списках люди пишут просто ```.
// Перенос длинных слов задан на обёртке, а не только у инлайн-кода: сюда едут тела
// задач и обсуждений, описания шагов и заметки релизов — текст, который пишет человек.
// Абзацы и автоссылки GFM сами не рвутся, поэтому одна ссылка без пробелов уносила
// страницу за край (замер: тело обсуждения — 2235px при экране 390).
export function Markdown({ children, className, refBase }: { children: string; className?: string; refBase?: string }) {
  if (!children?.trim()) return null
  return (
    <div className={cn('text-[0.8125rem] leading-snug text-ink-2 [overflow-wrap:anywhere] [&>*+*]:mt-1.5 [&_li:has(input)]:list-none', className)}>
      <ReactMarkdown
        remarkPlugins={refBase ? [remarkGfm, remarkIssueRefs(refBase)] : [remarkGfm]}
        components={{
          a: (p) => <a {...p} target="_blank" rel="noreferrer" className="text-accent hover:underline" />,
          code: (p) => <code {...p} className="rounded-md bg-surface-2 px-1 py-0.5 font-mono text-[0.9em] text-ink [overflow-wrap:anywhere]" />,
          pre: (p) => {
            const c = codeOf(p.children)
            if (c) return <CodeCard code={c.code} name={codeLabel(c.name, c.code)} />
            // Фолбэк: содержимое не удалось вынуть строкой (вложенная разметка) —
            // остаётся прежний <pre>, но с переносом, а не горизонтальным скроллом.
            return <pre {...p} className="overflow-x-auto rounded-md border border-border bg-surface-2 p-2.5 font-mono text-[0.78125rem] text-ink" />
          },
          ul: (p) => <ul {...p} className="list-disc pl-5" />,
          ol: (p) => <ol {...p} className="list-decimal pl-5" />,
          strong: (p) => <strong {...p} className="font-semibold text-ink" />,
          del: (p) => <del {...p} className="text-muted" />,
          h1: (p) => <div {...p} className="text-[1rem] font-semibold text-ink" />,
          h2: (p) => <div {...p} className="text-[0.875rem] font-semibold text-ink" />,
          h3: (p) => <div {...p} className="font-semibold text-ink" />,
          blockquote: (p) => <blockquote {...p} className="border-l-2 border-border pl-3 text-muted" />,
          input: (p) => <input {...p} disabled className="mr-1.5 align-middle accent-accent" />,
          img: (p) => (
            <SmartImage src={typeof p.src === 'string' ? p.src : ''} alt={p.alt || ''} className="my-1.5 max-w-full rounded-md border border-border" />
          ),
          table: (p) => (
            <div className="overflow-x-auto">
              <table {...p} className="w-full border-collapse text-[0.78125rem]" />
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
