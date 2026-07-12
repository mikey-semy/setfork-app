'use client'

import { useActionState } from 'react'
import { t, type Lang } from '@/shared/i18n'
import { Button } from '@/shared/ui/button'
import { Input } from '@/shared/ui/input'
import { Textarea } from '@/shared/ui/textarea'
import { FEEDBACK_BODY_MAX } from './validate'
import { submitFeedback, type FeedbackResult } from './actions'

const selectCls =
  'h-[42px] w-full appearance-none rounded-md border border-border bg-surface-2 px-3 text-[14px] text-ink outline-hidden focus:border-border-strong'

export function FeedbackForm({ lang }: { lang: Lang }) {
  const [state, action, pending] = useActionState<FeedbackResult, FormData>(submitFeedback, null)

  if (state?.ok) {
    return (
      <div className="rounded-xl border border-border bg-surface p-6 text-center">
        <div className="mb-1 text-[16px] font-bold text-ink">{t('fbThanks', lang)}</div>
        <p className="text-[13.5px] text-ink-2">{t('fbThanksBody', lang)}</p>
      </div>
    )
  }

  return (
    <form action={action} className="flex flex-col gap-3">
      <label className="flex flex-col gap-1.5">
        <span className="text-[12.5px] font-semibold text-ink-2">{t('fbCatLabel', lang)}</span>
        <select name="category" defaultValue="other" className={selectCls}>
          <option value="bug">{t('fbCatBug', lang)}</option>
          <option value="idea">{t('fbCatIdea', lang)}</option>
          <option value="content">{t('fbCatContent', lang)}</option>
          <option value="legal">{t('fbCatLegal', lang)}</option>
          <option value="other">{t('fbCatOther', lang)}</option>
        </select>
      </label>

      <Textarea
        name="body"
        required
        minLength={10}
        maxLength={FEEDBACK_BODY_MAX}
        rows={6}
        placeholder={t('fbBodyPlaceholder', lang)}
      />

      <div>
        <Input name="email" type="email" autoComplete="email" placeholder={t('fbEmailPlaceholder', lang)} />
        <p className="mt-1 text-[11.5px] text-muted">{t('fbEmailHint', lang)}</p>
      </div>

      {/* Honeypot: люди поле не видят и не заполняют; непустое значение = бот. */}
      <input
        type="text"
        name="website"
        tabIndex={-1}
        autoComplete="off"
        aria-hidden="true"
        className="absolute -left-[9999px] h-0 w-0 opacity-0"
      />
      {/* Откуда пришли — справочный контекст; реф-коллбэк вместо state (нет лишнего ререндера). */}
      <input
        type="hidden"
        name="pageUrl"
        defaultValue=""
        ref={(el) => {
          if (el && !el.value) el.value = document.referrer || ''
        }}
      />

      {state?.error && <div className="text-[12.5px] text-danger">{state.error}</div>}
      <Button type="submit" variant="primary" disabled={pending} className="px-4 py-2.5 text-[14px] disabled:opacity-60">
        {t('fbSend', lang)}
      </Button>
    </form>
  )
}
