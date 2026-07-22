'use client'

import { useTransition } from 'react'
import { MoreHorizontal, Pin, PinOff } from 'lucide-react'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/shared/ui/dropdown-menu'
import { setListPinned } from './actions'
import { ShareMenuItems, type ShareLabels } from './ShareButton'

/**
 * «...» шапки списка — вторичные действия одним overflow-меню (как GitHub), а не
 * россыпью разновысоких кнопок во второй строке. Держит Pin (владельцу публичного)
 * и «Поделиться» (переиспользуя ShareMenuItems). Видимыми в ряду остаются только
 * Star/Fork/Watch. Триггер 38px — ряд ровный (эталон: секции настроек).
 */
export function ListHeaderMenu({
  moreLabel,
  canPin,
  templateId,
  pinned,
  pinLabel,
  unpinLabel,
  path,
  shareTitle,
  ru,
  share,
}: {
  moreLabel: string
  canPin: boolean
  templateId: string
  pinned: boolean
  pinLabel: string
  unpinLabel: string
  path: string
  shareTitle: string
  ru: boolean
  share: ShareLabels
}) {
  const [pending, start] = useTransition()

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={moreLabel}
          title={moreLabel}
          className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-border text-ink transition-colors hover:border-border-strong"
        >
          <MoreHorizontal size={16} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-[248px] p-2">
        {canPin && (
          <>
            <DropdownMenuItem
              disabled={pending}
              onSelect={() => start(async () => { await setListPinned(templateId, !pinned) })}
            >
              {pinned ? <PinOff size={15} className="text-muted" /> : <Pin size={15} className="text-muted" />}
              {pinned ? unpinLabel : pinLabel}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        )}
        <ShareMenuItems path={path} title={shareTitle} ru={ru} {...share} />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
