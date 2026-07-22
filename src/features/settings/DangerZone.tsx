'use client'

import { useActionState, useState } from 'react'
import { Trash2 } from 'lucide-react'
import { Button } from '@/shared/ui/button'
import { ConfirmDialog } from '@/shared/ui/ConfirmDialog'
import { t, type Lang } from '@/shared/i18n'
import { deleteAccount, type ActionResult } from './actions'

export function DangerZone({ lang, handle }: { lang: Lang; handle: string }) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(deleteAccount, null)
  const [open, setOpen] = useState(false)

  return (
    <section className="overflow-hidden rounded-lg border border-danger/40">
      <div className="border-b border-danger/40 bg-danger/5 px-5 py-2.5 font-semibold text-danger">{t('dangerZone', lang)}</div>
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
        <div className="min-w-0">
          <div className="text-[14px] font-medium text-ink">{t('deleteAccount', lang)}</div>
          <p className="mt-0.5 max-w-[560px] text-[12.5px] text-ink-2">{t('deleteAccountHint', lang)}</p>
        </div>
        <Button variant="danger" size="md" onClick={() => setOpen(true)} className="gap-2 border border-danger/40">
          <Trash2 size={14} /> {t('deleteAccount', lang)}
        </Button>
      </div>

      {/* Серверный режим: deleteAccount повторно сверяет поле confirm с ником. */}
      <ConfirmDialog
        open={open}
        onClose={() => setOpen(false)}
        title={t('deleteAccount', lang)}
        intro={t('deleteAccountHint', lang)}
        confirmPhrase={handle}
        confirmHint={t('deleteConfirmLabel', lang)}
        confirmLabel={t('deleteAccount', lang)}
        cancelLabel={t('cancel', lang)}
        busy={pending}
        error={state?.error}
        formAction={action}
      />
    </section>
  )
}
