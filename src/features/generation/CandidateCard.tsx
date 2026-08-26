'use client'

import { useState } from 'react'
import { ChevronDown, Link2 } from 'lucide-react'
import type { GenerationCandidate } from '@/shared/db'
import type { Lang } from '@/shared/i18n'
import { safeHref } from '@/shared/lib/safe-url'
import { detectLang, LANG_LABEL } from '@/shared/ui/detect-lang'
import { t } from '@/shared/i18n'
import { buttonClass } from '@/shared/ui/button-style'

/**
 * Вариант списка карточкой. СВЁРНУТ по умолчанию (фидбек владельца: показывать
 * основную идею кратко, полный список — по клику; лента вариантов стала компактной,
 * и понятно, что сравнивать). Клик по карточке = выбрать и раскрыть/свернуть.
 *
 * selected — выбор для действия «Использовать этот» (меню у поля ввода).
 */
export function CandidateCard({
  cand,
  selected,
  onSelect,
  lang,
}: {
  cand: GenerationCandidate
  selected: boolean
  onSelect: () => void
  lang: Lang
}) {
  const [open, setOpen] = useState(false)
  return (
    <button
      type="button"
      onClick={() => {
        onSelect()
        setOpen((v) => !v)
      }}
      aria-pressed={selected}
      aria-expanded={open}
      // eslint-disable-next-line no-restricted-syntax -- реплика чата: скруглениями изображает «хвостик» пузыря, это не карточка
      className={`w-full rounded-2xl rounded-bl-md border bg-surface p-4 text-left transition-colors ${
        selected ? 'border-accent' : 'border-border hover:border-border-strong'
      }`}
    >
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="text-body-lg font-semibold text-ink">{cand.title}</div>
          {cand.desc && <p className="mt-1 text-body-sm text-ink-2">{cand.desc}</p>}
        </div>
        <span className="mt-0.5 inline-flex shrink-0 items-center gap-1 text-caption text-muted">
          {cand.items.length} <ChevronDown size={13} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
        </span>
      </div>
      {cand.tags.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {cand.tags.map((tg) => (
            <span key={tg} className="rounded-full bg-surface-2 px-2 py-0.5 text-caption text-ink-2">
              {tg}
            </span>
          ))}
        </div>
      )}
      {!open && (
        <div className="mt-2 text-caption text-muted">{t('generation.tapSeeFullList', lang)}</div>
      )}
      {/* Секции (напр. рецепт: «Ингредиенты» / «Приготовление») — двойной список, а не всё в кучу.
          Группируем по item.section; нет секций → плоский список, как раньше. Нумерация внутри секции. */}
      <div className={open ? 'mt-3.5 space-y-4' : 'hidden'}>
        {groupBySection(cand.items).map((g, gi) => (
          <div key={gi}>
            {g.section && <div className="mb-1.5 text-caption font-semibold tracking-wide text-muted uppercase">{g.section}</div>}
            <ol className="space-y-3">
              {g.items.map(({ it, n }) => (
                <li key={n} className="border-l-2 border-border pl-3">
                  <div className="text-body font-medium text-ink">
                    <span className="text-muted">{n}.</span> {it.title}
                  </div>
                  {it.desc && <div className="mt-0.5 text-body-sm text-ink-2">{it.desc}</div>}
                  {it.command && (
                    // Бейдж языка в углу (detect-lang, как в редакторе); перенос вместо
                    // горизонтального скролла. CopyButton нельзя: карточка сама <button>.
                    <code className="relative mt-1 block whitespace-pre-wrap rounded-md bg-surface-2 px-2 py-1 pr-14 font-mono text-body-sm text-ink [overflow-wrap:anywhere]">
                      {it.command}
                      <span className="absolute right-1.5 top-1 font-mono text-caption uppercase tracking-wide text-muted">{LANG_LABEL[detectLang(it.command)]}</span>
                    </code>
                  )}
                  {it.subtasks.length > 0 && (
                    <ul className="mt-1 space-y-0.5">
                      {it.subtasks.map((s, j) => (
                        <li key={j} className="text-body-sm text-muted">
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
                          className={buttonClass({ className: 'bg-surface-2 text-accent hover:underline' })}
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

/** Пункты в группы по section, сохраняя порядок; нумерация СКВОЗНАЯ через все
 *  секции (фидбек владельца: «с 1 после каждого заголовка» сбивала с толку;
 *  страница списка нумерует так же — displayNum). */
function groupBySection(items: CardItem[]): { section: string; items: { it: CardItem; n: number }[] }[] {
  const groups: { section: string; items: { it: CardItem; n: number }[] }[] = []
  let seq = 0
  for (const it of items) {
    const section = it.section ?? ''
    let g = groups[groups.length - 1]
    if (!g || g.section !== section) {
      g = { section, items: [] }
      groups.push(g)
    }
    g.items.push({ it, n: ++seq })
  }
  return groups
}
