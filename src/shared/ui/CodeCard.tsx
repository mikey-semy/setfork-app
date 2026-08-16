import { CopyButton } from './CopyButton'
import { highlightLines } from './highlight-code'
import { TEXT } from './control'
import type { Lang } from '@/shared/i18n'

/**
 * Карточка кода для ЧТЕНИЯ (не редактор): подсветка синтаксиса, номера строк,
 * перенос длинных строк вместо горизонтального скролла (правило владельца: код в
 * своей форме, скролла нет).
 *
 * БЕЗ ПОЛОСЫ-ШАПКИ. Отдельная строка с именем и кнопкой съедала около 28px над
 * каждым блоком, а несла всего два служебных элемента — на телефоне это заметная
 * часть экрана (жалоба владельца 04.08.2026). Язык и «копировать» теперь висят в
 * правом верхнем углу самой карточки, там же, где остальные служебные действия в
 * интерфейсе. Код под них не подлезает: правый отступ получает ПЕРВАЯ строка,
 * остальные идут во всю ширину.
 *
 * Подсветка построчная (highlight-code): токены раскладываются по строкам, поэтому
 * номера и перенос сохраняются — готовый HTML от highlight.js так резать нельзя.
 * Язык берём из `name`: он приходит из ограды markdown или от детектора.
 */
export function CodeCard({ code, name, lang }: { code: string; name?: string; lang?: Lang }) {
  const label = name || 'code'
  const lines = highlightLines(code, name)
  // Минимальная высота карточки — под служебный угол, а не под текст: блок из ОДНОЙ
  // строки занимает ~37px, а кнопка копирования на тач-экране 44px, и угол выпирал за
  // низ карточки (жалоба владельца 04.08.2026). Уменьшать кнопку нельзя — 44px это
  // норма тач-цели, поэтому карточка просто не бывает ниже своего угла.
  return (
    <div className="sf-code-card relative my-1.5 min-h-10 overflow-hidden rounded-md border border-border bg-surface-2 pointer-coarse:min-h-13">
      {/* Правый верхний угол — служебное (правило углов). Подложка у бейджа на случай,
          если первая строка всё же окажется длинной и пройдёт под ним. */}
      <div className="absolute right-1 top-1 z-10 flex items-center gap-1 print:hidden">
        <span className={`rounded bg-surface-2/85 px-1.5 py-0.5 font-mono ${TEXT.caption} uppercase tracking-wide text-muted`}>{label}</span>
        <CopyButton text={code} lang={lang} />
      </div>
      <div className="py-2 font-mono text-[0.78125rem] leading-[1.55] text-ink">
        {lines.map((tokens, i) => (
          // Отступ под бейдж и кнопку нужен только первой строке: 44px тач-цель +
          // бейдж + зазор. Остальные строки во всю ширину — иначе узкий экран теряет
          // сотню пикселей на каждой строке кода.
          <div key={i} className={`flex gap-2 px-2.5 ${i === 0 ? 'pr-[6.5rem]' : ''}`}>
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
