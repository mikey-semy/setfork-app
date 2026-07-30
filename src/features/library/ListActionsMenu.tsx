'use client'

import { useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Languages, MoreHorizontal, Pencil } from 'lucide-react'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/shared/ui/dropdown-menu'
import { Tooltip } from '@/shared/ui/Tooltip'
import { LANG_META, t, type Lang } from '@/shared/i18n'
import { toast } from '@/shared/ui/toast'
import { translateList } from './actions'

/**
 * Вторичные действия панели списка: правка и перевод.
 *
 * Пока их ДВА — это «...»-меню (как overflow у GitHub), а не россыпь разновысоких
 * кнопок в ряду. Но перевод показывается редко (только владельцу и только когда
 * контент иноязычный), и в обычном случае в меню остаётся ОДИН пункт — «Редактировать».
 * Выпадающее меню ради одного пункта — лишний тап и лишняя загадка: по карандашу и так
 * понятно, что кнопка делает. Поэтому один пункт рисуем прямой кнопкой-иконкой с
 * тултипом, а «...» возвращается только когда в нём правда есть выбор.
 *
 * Высота у всех веток одна (h-9, как Run и «Получить») — ряд остаётся ровным.
 */
export function ListActionsMenu({
  base,
  isOwner,
  templateId,
  lang,
  canTranslate,
  targetLang,
}: {
  base: string
  isOwner: boolean
  templateId: string
  lang: Lang
  /** Показывать «Перевести» — только владельцу/коллаборатору и когда контент реально иноязычный. */
  canTranslate: boolean
  targetLang: Lang
}) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const say = (en: string, ru: string) => (lang === 'ru' ? ru : en) // строки-аргументами (i18n-lint)
  const translateLabel = t('translateInto', lang).replace('{lang}', LANG_META[targetLang].endonym)

  const doTranslate = () =>
    start(async () => {
      const res = await translateList(templateId, targetLang)
      if ('error' in res) toast.error(t('translateFailed', lang))
      else router.refresh()
    })

  const editHref = isOwner ? `${base}/edit` : `${base}/suggest`
  const editLabel = isOwner ? t('edit', lang) : t('suggestEdit', lang)
  const btn = 'inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-border text-ink transition-colors hover:border-border-strong'

  // Единственное действие — сразу кнопкой, без меню.
  if (!canTranslate) {
    return (
      <Tooltip label={editLabel}>
        <Link href={editHref} aria-label={editLabel} className={btn}>
          <Pencil size={16} />
        </Link>
      </Tooltip>
    )
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" aria-label={say('More actions', 'Ещё действия')} className={btn}>
          <MoreHorizontal size={16} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem asChild>
          <Link href={editHref}>
            <Pencil size={15} className="text-muted" /> {editLabel}
          </Link>
        </DropdownMenuItem>
        {canTranslate && (
          <DropdownMenuItem
            disabled={pending}
            onSelect={(e) => {
              e.preventDefault() // не закрывать до старта перехода
              doTranslate()
            }}
          >
            <Languages size={15} className="text-muted" /> {translateLabel}
          </DropdownMenuItem>
        )}
        {/* «Коммиты» отсюда ушли: они теперь иконкой с тултипом в строке автора
            (как значок истории справа от коммита у GitHub) — там им и место. */}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
