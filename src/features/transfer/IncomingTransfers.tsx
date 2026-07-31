'use client'

import { useTransition } from 'react'
import { UserRoundPlus } from 'lucide-react'
import { Button } from '@/shared/ui/button'
import { ActionRow, DangerZone } from '@/shared/ui/DangerZone'
import { tr, t, type Lang } from '@/shared/i18n'
import { acceptTransfer, declineTransfer } from './actions'
import type { IncomingTransfer } from './queries'

// Входящие передачи списков (получатель принимает/отклоняет). Список может быть
// приватным — поэтому принимаем ЗДЕСЬ, а не на странице списка (её не видно).
export function IncomingTransfers({ items, lang }: { items: IncomingTransfer[]; lang: Lang }) {
  const [pending, start] = useTransition()
  return (
    <DangerZone
      title={
        <span className="inline-flex items-center gap-1.5">
          <UserRoundPlus size={15} /> {t('incomingTransfersTitle', lang)}
        </span>
      }
    >
      {items.map((it) => (
        <ActionRow key={it.id} title={tr(it.title, lang)} sub={`@${it.fromHandle} ${t('transferOffersYou', lang)}`}>
          <button
            type="button"
            onClick={() => start(() => declineTransfer(it.id))}
            disabled={pending}
            className="rounded-md border border-border px-3 py-2 text-[13px] font-medium text-ink-2 hover:text-ink disabled:opacity-60"
          >
            {t('transferDecline', lang)}
          </button>
          <Button variant="primary" size="md" onClick={() => start(() => acceptTransfer(it.id))} disabled={pending}>
            {t('transferAccept', lang)}
          </Button>
        </ActionRow>
      ))}
    </DangerZone>
  )
}
