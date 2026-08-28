'use client'
import { useActionState, useRef, useState } from 'react'
import { Input } from '@/shared/ui/input'
import { MarkdownEditor } from '@/shared/ui/MarkdownEditor'
import { SubmitButton } from '@/shared/ui/SubmitButton'
import { t, type Lang } from '@/shared/i18n'
import { createIssue, type IssueRefusal } from './actions'
import { LabelPicker } from './LabelPicker'
import type { CustomLabel } from '@/shared/lib/labels'

const inputCls = 'px-3 py-2 text-body-lg'

// Клиентская форма нового issue: валидация заголовка БЕЗ потери тела (никаких server-redirect
// со стиранием текста). Ошибка появляется анимированно (grid 0fr→1fr), без резкого сдвига.
export function NewIssueForm({ owner, slug, lang, custom = [] }: { owner: string; slug: string; lang: Lang; custom?: CustomLabel[] }) {
  const [error, setError] = useState(false)
  const titleRef = useRef<HTMLInputElement>(null)
  // Серверный отказ приходит ЗНАЧЕНИЕМ: проверка ниже не даёт отправить пустое, но без
  // JS её нет, и раньше серверная ветка уносила переходом, стирая набранное тело.
  const [refusal, action] = useActionState<IssueRefusal | null, FormData>(createIssue, null)

  return (
    <form
      action={action}
      onSubmit={(e) => {
        if (!titleRef.current?.value.trim()) {
          e.preventDefault() // не сабмитим — тело сохраняется в состоянии редактора
          setError(true)
          titleRef.current?.focus()
        }
      }}
      className="flex flex-col gap-3"
    >
      <input type="hidden" name="owner" value={owner} />
      <input type="hidden" name="slug" value={slug} />
      <div>
        <Input
          ref={titleRef}
          name="title"
          required
          onChange={() => error && setError(false)}
          className={`${inputCls} ${error || refusal === 'empty' ? 'border-danger focus:border-danger' : ''}`}
          aria-label={t('issueTitlePh', lang)}
          placeholder={t('issueTitlePh', lang)}
          autoFocus
          maxLength={200}
        />
        <div className={`grid overflow-hidden transition-all dur-base ${error || refusal === 'empty' ? 'mt-1.5 grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}>
          <p className="min-h-0 overflow-hidden text-body-sm text-danger">{t('titleRequired', lang)}</p>
        </div>
      </div>

      <MarkdownEditor name="body" rows={8} placeholder={t('issueBodyPh', lang)} maxLength={20000} lang={lang} refScope={{ owner, slug }} />

      <div>
        <div className="mb-1.5 text-body-sm font-semibold text-ink-2">{t('labelsLabel', lang)}</div>
        <LabelPicker lang={lang} custom={custom} />
      </div>

      <div className="flex justify-end">
        <SubmitButton>
          {t('submitNewIssue', lang)}
        </SubmitButton>
      </div>
    </form>
  )
}
