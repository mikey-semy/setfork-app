import { CopyButton } from './CopyButton'
import { highlightLines } from './highlight-code'
import type { Lang } from '@/shared/i18n'

/**
 * Карточка кода для ЧТЕНИЯ (не редактор): шапка с языком и кнопкой «копировать»
 * в правом верхнем углу, номера строк, подсветка синтаксиса, перенос длинных
 * строк вместо горизонтального скролла (правило владельца: код в своей форме,
 * скролла нет).
 *
 * Подсветка построчная (highlight-code): токены раскладываются по строкам, поэтому
 * номера и перенос сохраняются — готовый HTML от highlight.js так резать нельзя.
 * Язык берём из шапки (`name`): он же приходит из ограды markdown или от детектора.
 */
export function CodeCard({ code, name, lang }: { code: string; name?: string; lang?: Lang }) {
  const label = name || 'code'
  const lines = highlightLines(code, name)
  return (
    <div className="my-1.5 overflow-hidden rounded-md border border-border bg-surface-2">
      <div className="flex items-center justify-between gap-2 border-b border-border px-2.5 py-1">
        <span className="truncate font-mono text-[0.6875rem] uppercase tracking-wide text-muted">{label}</span>
        <CopyButton text={code} lang={lang} />
      </div>
      <div className="py-1.5 font-mono text-[0.78125rem] leading-[1.55] text-ink">
        {lines.map((tokens, i) => (
          <div key={i} className="flex gap-2 px-2.5">
            <span className="w-5 shrink-0 select-none text-right text-[0.6875rem] leading-[1.7] text-muted">{i + 1}</span>
            <span className="min-w-0 whitespace-pre-wrap [overflow-wrap:anywhere]">
              {tokens.length === 0 ? ' ' : tokens.map((t, j) => (t.cls ? <span key={j} className={t.cls}>{t.text}</span> : <span key={j}>{t.text}</span>))}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
