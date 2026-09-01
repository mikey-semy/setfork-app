import { t, type Lang } from '@/shared/i18n'
import { LIST_VISIBILITY_BADGE, listVisibilityState } from '@/shared/list-visibility'
import { cn } from '@/shared/lib/cn'

/**
 * Состояние списка ПЛАШКОЙ У ИМЕНИ — публичный, приватный, черновик.
 *
 * Раньше оно жило в строке показателей, между версией и числом форков: чтобы понять,
 * опубликован ли список, приходилось читать строку цифр под ним. У GitHub бейдж
 * `Private` стоит сразу за именем, и при беглом просмотре десятка карточек состояние
 * видно там же, где имя, — эталон взят оттуда (решение владельца 01.09.2026).
 *
 * Публичное состояние плашкой НЕ рисуется: оно и есть норма, а плашка на каждой
 * карточке превратилась бы в шум. Молчание значит «публичный» — ровно как у GitHub,
 * где помечают только Private, Fork и Archived.
 */
export function ListStateBadge({
  item,
  lang,
  className,
}: {
  item: { status: 'draft' | 'published'; visibility: 'public' | 'private' }
  lang: Lang
  className?: string
}) {
  const state = listVisibilityState(item)
  if (state === 'public') return null
  const badge = LIST_VISIBILITY_BADGE[state]
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1 rounded-full border px-1.5 py-px text-caption',
        badge.tone,
        className,
      )}
    >
      <badge.Icon size={11} />
      {t(badge.labelKey, lang)}
    </span>
  )
}
