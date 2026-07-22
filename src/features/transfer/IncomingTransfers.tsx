'use client'

import { useTransition } from 'react'
import { UserRoundPlus } from 'lucide-react'
import { Button } from '@/shared/ui/button'
import { tr, t, type Lang } from '@/shared/i18n'
import { acceptTransfer, declineTransfer } from './actions'
import type { IncomingTransfer } from './queries'

// Входящие передачи списков (получатель принимает/отклоняет). Список может быть
// приватным — поэтому принимаем ЗДЕСЬ, а не на странице списка (её не видно).
export function IncomingTransfers({ items, lang }: { items: IncomingTransfer[]; lang: Lang }) {
  const [pending, start] = useTransition()
  return (
    <section className="overflow-hidden rounded-lg border border-warn/40">
      <div className="flex items-center gap-1.5 border-b border-warn/40 bg-warn/10 px-5 py-2.5 font-semibold text-warn">
        <UserRoundPlus size={15} /> {t('incomingTransfersTitle', lang)}
      </div>
      <div className="divide-y divide-border px-5">
        {items.map((it) => (
          <div key={it.id} className="flex flex-wrap items-center justify-between gap-3 py-4">
            <div className="min-w-0">
              <div className="truncate text-[14px] font-medium text-ink">{tr(it.title, lang)}</div>
              <p className="mt-0.5 text-[12.5px] text-ink-2">
                @{it.fromHandle} {t('transferOffersYou', lang)}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
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
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}
