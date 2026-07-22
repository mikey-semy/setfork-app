'use client'

import { useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { GitCommitHorizontal, Languages, MoreHorizontal, Pencil } from 'lucide-react'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/shared/ui/dropdown-menu'
import { LANG_META, t, type Lang } from '@/shared/i18n'
import { toast } from '@/shared/ui/toast'
import { translateList } from './actions'

/**
 * «...» — вторичные действия панели списка одним меню (как overflow-меню GitHub),
 * а не россыпью разновысоких кнопок/иконок в ряду. Видимыми остаются только
 * первичные Run + Получить; правка/перевод/история/blame — здесь. Триггер той же
 * высоты (38px), что Run и Получить, — ряд ровный (эталон: секции настроек).
 */
export function ListActionsMenu({
  base,
  isOwner,
  templateId,
  lang,
  versionsCount,
  canTranslate,
  targetLang,
}: {
  base: string
  isOwner: boolean
  templateId: string
  lang: Lang
  versionsCount: number
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

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={say('More actions', 'Ещё действия')}
          className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-border text-ink transition-colors hover:border-border-strong"
        >
          <MoreHorizontal size={16} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem asChild>
          <Link href={isOwner ? `${base}/edit` : `${base}/suggest`}>
            <Pencil size={15} className="text-muted" /> {isOwner ? t('edit', lang) : t('suggestEdit', lang)}
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
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href={`${base}/versions`}>
            <GitCommitHorizontal size={15} className="text-muted" /> {t('versionsTab', lang)}
            <span className="ml-auto font-mono text-[12px] text-muted">{versionsCount}</span>
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
