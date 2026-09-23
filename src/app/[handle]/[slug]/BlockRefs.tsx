import { ExternalLink } from 'lucide-react'
import { SafeLink } from '@/shared/ui/SafeLink'
import { linkLabel } from '@/shared/lib/link-label'
import { tr, type Lang, type LocaleText } from '@/shared/i18n'
import { badgeClass } from '@/shared/ui/badge'
import type { ListPageData } from './load'

type Props = Pick<ListPageData, 'readOnlyView' | 'mon'> & {
  step: ListPageData['steps'][number]
  lang: Lang
}

/**
 * Ссылки блока — источники, документация — чипами под содержимым.
 *
 * Общие для шага и текстового блока. Раньше жили внутри карточки шага, и у текста
 * их не было вовсе: справочный список, где у каждого пункта есть источники, можно
 * было собрать только из шагов или вписывать ссылки в текст строкой. Хранилище и
 * канон `refs` держат у любого блока, поэтому и показ у них один (#962).
 */
export function BlockRefs({ step, readOnlyView, mon, lang }: Props) {
  // href — через /api/go (журнал кликов), если трекинг включён в админке. Маршрут
  // берёт refs[i] у любой строки, не только у шага. У веток snapshot-блоки без
  // DB-id → прямой url. Экспорт/MD не трогаем.
  const refs = ((step.refs ?? []) as { label: LocaleText; url?: string }[]).map((x, ri) => ({
    label: tr(x.label, lang),
    url: x.url,
    href: x.url && !readOnlyView && mon.linkTracking ? `/api/go/${step.id}/${ri}` : x.url,
  }))
  if (refs.length === 0) return null
  return (
    <div className="mt-3 flex flex-wrap gap-2">
      {refs.map((r) => {
        // Подпись ссылки нередко и есть URL — без переноса чип уносит страницу.
        const cls = badgeClass({
          variant: 'chip',
          shape: 'square',
          className: 'min-w-0 px-2.5 py-1 text-accent [overflow-wrap:anywhere]',
        })
        // Подписи может не быть (ссылку кладут одним url) — показываем домен.
        const text = linkLabel(r.label, r.url)
        return r.url ? (
          <SafeLink key={`${r.label}:${r.url}`} href={r.href ?? r.url} rel="nofollow noreferrer" className={cls}>
            <ExternalLink size={11} /> {text}
          </SafeLink>
        ) : (
          <span key={`${r.label}:`} className={cls}>
            <ExternalLink size={11} /> {text}
          </span>
        )
      })}
    </div>
  )
}
