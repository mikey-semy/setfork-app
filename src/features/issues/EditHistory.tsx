'use client'
import { useState } from 'react'
import { t, type Lang } from '@/shared/i18n'
import { buttonClass } from '@/shared/ui/button-style'
import type { ContentRevision } from './edit-actions'

/**
 * Пометка «изменено» и список прежних версий текста.
 *
 * ⚠️ ПОМЕТКА ОБЯЗАТЕЛЬНА, А НЕ УКРАШЕНИЕ. Правка без видимого следа — способ переписать
 * сказанное задним числом; история существует ровно затем, чтобы это было видно. У
 * GitHub и Gitea пометка стоит там же — в шапке реплики, рядом с датой.
 *
 * Раскрывается по нажатию: на телефоне десяток раскрытых историй в треде превратил бы
 * страницу в стену текста, а нужна она изредка.
 */
export function EditHistory({
  revisions,
  authorOf,
  lang,
}: {
  revisions: ContentRevision[]
  /** id → ник: карточка знает участников, а ревизия хранит только id. */
  authorOf: Record<string, string>
  lang: Lang
}) {
  const [open, setOpen] = useState(false)
  if (!revisions.length) return null
  const fmt = new Intl.DateTimeFormat(lang, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

  return (
    <>
      {/* Общим рецептом, а не голым <button>: иначе пометка мимо тач-цели и фокуса
          (узда ui-parity, «кнопка-невидимка»). Вид — ступень шкалы, подчёркивание
          отличает её от кнопок-действий в той же шапке. */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className={buttonClass({
          variant: 'ghost',
          size: 'sm',
          className: 'shrink-0 px-1.5 underline underline-offset-2',
        })}
      >
        {t('issue.edited', lang)}
      </button>
      {open && (
        <ol className="mt-2 w-full list-none border-t border-border pt-2 text-body-sm text-ink-2">
          {revisions.map((r) => (
            <li key={r.id} className="border-b border-border py-2 last:border-0">
              <div className="text-caption text-muted">
                {t('issue.revisionBy', lang).replace('{who}', authorOf[r.editorId] ?? '—')} · {fmt.format(new Date(r.createdAt))}
              </div>
              {r.prevTitle && <div className="mt-1 font-semibold text-ink">{r.prevTitle}</div>}
              <div className="mt-0.5 whitespace-pre-wrap [overflow-wrap:anywhere]">{r.prevBody || '—'}</div>
            </li>
          ))}
        </ol>
      )}
    </>
  )
}
