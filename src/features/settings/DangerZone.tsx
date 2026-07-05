'use client'

import { useActionState, useState } from 'react'
import { Trash2 } from 'lucide-react'
import { t, type Lang } from '@/shared/i18n'
import { Input } from '@/shared/ui/input'
import { deleteAccount, type ActionResult } from './actions'

export function DangerZone({ lang, handle }: { lang: Lang; handle: string }) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(deleteAccount, null)
  const [confirm, setConfirm] = useState('')
  const matches = confirm.trim().toLowerCase() === handle.toLowerCase()

  return (
    <section className="rounded-lg border border-danger/40 bg-danger/5 p-5">
      <div className="mb-1 font-semibold text-danger">{t('dangerZone', lang)}</div>
      <p className="mb-4 max-w-[560px] text-[13px] text-ink-2">{t('deleteAccountHint', lang)}</p>

      <form action={action} className="flex flex-col gap-3">
        <label className="text-[12.5px] font-semibold text-ink-2">
          {t('deleteConfirmLabel', lang)} <span className="font-mono text-ink">{handle}</span>
        </label>
        <div className="flex flex-wrap items-center gap-3">
          <Input
            name="confirm"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            autoComplete="off"
            className="w-[240px] px-3 py-2 font-mono text-[13px] focus:border-danger"
          />
          <button
            disabled={!matches || pending}
            className="inline-flex items-center gap-2 rounded-md bg-danger px-4 py-2 text-[13px] font-semibold text-white disabled:opacity-40"
          >
            <Trash2 size={14} /> {t('deleteAccount', lang)}
          </button>
          {state?.error && <span className="text-[13px] text-danger">{state.error}</span>}
        </div>
      </form>
    </section>
  )
}
