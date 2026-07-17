'use client'

import { Link2 } from 'lucide-react'
import type { GenerationCandidate } from '@/shared/db'
import { safeHref } from '@/shared/lib/safe-url'

/**
 * Вариант списка карточкой. Раньше рисовался на весь экран и подменялся табами «Вариант 1/2/3»;
 * теперь это реплика в беседе — вариантов может быть видно сразу несколько, и старые никуда не деваются.
 *
 * selected — выбор для действия «Использовать этот» (кнопка живёт в панели над чатом).
 */
export function CandidateCard({
  cand,
  selected,
  onSelect,
}: {
  cand: GenerationCandidate
  selected: boolean
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={`w-full rounded-2xl rounded-bl-md border bg-(--surface) p-4 text-left transition-colors ${
        selected ? 'border-(--accent)' : 'border-border hover:border-border-strong'
      }`}
    >
      <div className="text-[14.5px] font-semibold text-ink">{cand.title}</div>
      {cand.desc && <p className="mt-1 text-[12.5px] text-ink-2">{cand.desc}</p>}
      {cand.tags.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {cand.tags.map((tg) => (
            <span key={tg} className="rounded-full bg-surface-2 px-2 py-0.5 text-[11.5px] text-ink-2">
              {tg}
            </span>
          ))}
        </div>
      )}
      {/* Секции (напр. рецепт: «Ингредиенты» / «Приготовление») — двойной список, а не всё в кучу.
          Группируем по item.section; нет секций → плоский список, как раньше. Нумерация внутри секции. */}
      <div className="mt-3.5 space-y-4">
        {groupBySection(cand.items).map((g, gi) => (
          <div key={gi}>
            {g.section && <div className="mb-1.5 text-[11.5px] font-semibold tracking-wide text-muted uppercase">{g.section}</div>}
            <ol className="space-y-3">
              {g.items.map(({ it, n }) => (
                <li key={n} className="border-l-2 border-border pl-3">
                  <div className="text-[13.5px] font-medium text-ink">
                    <span className="text-muted">{n}.</span> {it.title}
                  </div>
                  {it.desc && <div className="mt-0.5 text-[12.5px] text-ink-2">{it.desc}</div>}
                  {it.command && (
                    <code className="mt-1 block rounded bg-surface-2 px-2 py-1 font-mono text-[12px] text-ink">{it.command}</code>
                  )}
                  {it.subtasks.length > 0 && (
                    <ul className="mt-1 space-y-0.5">
                      {it.subtasks.map((s, j) => (
                        <li key={j} className="text-[12px] text-muted">
                          ○ {s}
                        </li>
                      ))}
                    </ul>
                  )}
                  {it.refs && it.refs.length > 0 && (
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {it.refs.map((r, k) => (
                        // Ссылка внутри кликабельной карточки: клик по ней не должен «выбирать» вариант.
                        <a
                          key={k}
                          href={safeHref(r.url) || undefined}
                          target="_blank"
                          rel="noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="inline-flex items-center gap-1 rounded border border-border bg-surface-2 px-2 py-0.5 text-[11.5px] text-accent hover:underline"
                        >
                          <Link2 size={11} /> {r.label}
                        </a>
                      ))}
                    </div>
                  )}
                </li>
              ))}
            </ol>
          </div>
        ))}
      </div>
    </button>
  )
}

type CardItem = GenerationCandidate['items'][number]

/** Пункты в группы по section, сохраняя порядок; нумерация СВОЯ в каждой группе (ингредиенты 1..N,
 *  шаги 1..M). Секций нет → одна безымянная группа со сквозной нумерацией = прежний плоский вид. */
function groupBySection(items: CardItem[]): { section: string; items: { it: CardItem; n: number }[] }[] {
  const groups: { section: string; items: { it: CardItem; n: number }[] }[] = []
  for (const it of items) {
    const section = it.section ?? ''
    let g = groups[groups.length - 1]
    if (!g || g.section !== section) {
      g = { section, items: [] }
      groups.push(g)
    }
    g.items.push({ it, n: g.items.length + 1 })
  }
  return groups
}
