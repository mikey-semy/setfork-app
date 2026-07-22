import { CopyButton } from './CopyButton'

/**
 * Карточка кода для ЧТЕНИЯ (не редактор): шапка с именем и кнопкой «копировать»
 * в правом верхнем углу, номера строк, перенос длинных строк вместо
 * горизонтального скролла (правило владельца: код в своей форме, скролла нет).
 */
export function CodeCard({ code, name }: { code: string; name?: string }) {
  const lines = code.replace(/\n$/, '').split('\n')
  return (
    <div className="my-1.5 overflow-hidden rounded-md border border-border bg-surface-2">
      <div className="flex items-center justify-between gap-2 border-b border-border px-2.5 py-1">
        <span className="truncate font-mono text-[10.5px] uppercase tracking-wide text-muted">{name || 'code'}</span>
        <CopyButton text={code} />
      </div>
      <div className="py-1.5 font-mono text-[12px] leading-[1.55] text-ink">
        {lines.map((ln, i) => (
          <div key={i} className="flex gap-2 px-2.5">
            <span className="w-5 shrink-0 select-none text-right text-[10.5px] leading-[1.7] text-muted">{i + 1}</span>
            <span className="min-w-0 whitespace-pre-wrap [overflow-wrap:anywhere]">{ln || ' '}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
