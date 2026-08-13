'use client'

import { useActionState } from 'react'
import { t, type Lang } from '@/shared/i18n'
import { Button } from '@/shared/ui/button'
import { Input } from '@/shared/ui/input'
import { MarkdownEditor } from '@/shared/ui/MarkdownEditor'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select'
import { FEEDBACK_BODY_MAX } from './validate'
import { submitFeedback, type FeedbackResult } from './actions'
import { cardClass } from '@/shared/ui/card-style'

export function FeedbackForm({ lang }: { lang: Lang }) {
  const [state, action, pending] = useActionState<FeedbackResult, FormData>(submitFeedback, null)

  if (state?.ok) {
    return (
      <div className={cardClass({ pad: 'lg', className: 'text-center' })}>
        <div className="mb-1 text-[1rem] font-bold text-ink">{t('fbThanks', lang)}</div>
        <p className="text-[0.8125rem] text-ink-2">{t('fbThanksBody', lang)}</p>
      </div>
    )
  }

  return (
    <form action={action} className="flex flex-col gap-3">
      {/* Категория — общий shadcn-Select (Radix), а не самопальный <select> со своими
          стилями. name+defaultValue → Radix отдаёт значение форме скрытым нативным select. */}
      <div className="flex flex-col gap-1.5">
        <span className="text-[0.78125rem] font-semibold text-ink-2">{t('fbCatLabel', lang)}</span>
        <Select name="category" defaultValue="other">
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="bug">{t('fbCatBug', lang)}</SelectItem>
            <SelectItem value="idea">{t('fbCatIdea', lang)}</SelectItem>
            <SelectItem value="content">{t('fbCatContent', lang)}</SelectItem>
            <SelectItem value="legal">{t('fbCatLegal', lang)}</SelectItem>
            <SelectItem value="other">{t('fbCatOther', lang)}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Тело — тот же редактор с тулбаром, что в issues/обсуждениях (не голая textarea).
          Пустоту/длину валидирует сервер (parseFeedback: body_short/body_long). */}
      <MarkdownEditor name="body" rows={6} maxLength={FEEDBACK_BODY_MAX} placeholder={t('fbBodyPlaceholder', lang)} lang={lang} />

      <div>
        <Input name="email" type="email" autoComplete="email" placeholder={t('fbEmailPlaceholder', lang)} />
        <p className="mt-1 text-[0.6875rem] text-muted">{t('fbEmailHint', lang)}</p>
      </div>

      {/* Honeypot: люди поле не видят и не заполняют; непустое значение = бот. */}
      <input
        type="text"
        name="website"
        tabIndex={-1}
        autoComplete="off"
        aria-hidden="true"
        className="absolute -left-[624.9375rem] h-0 w-0 opacity-0"
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

      {state?.error && <div className="text-[0.78125rem] text-danger">{state.error}</div>}
      <Button type="submit" variant="primary" size="lg" disabled={pending} className="disabled:opacity-60">
        {t('fbSend', lang)}
      </Button>
    </form>
  )
}
