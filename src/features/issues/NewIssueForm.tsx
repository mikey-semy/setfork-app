'use client'
import { useRef, useState } from 'react'
import { MarkdownEditor } from '@/shared/ui/MarkdownEditor'
import { t, type Lang } from '@/shared/i18n'
import { createIssue } from './actions'
import { LabelPicker } from './LabelPicker'

const inputCls = 'w-full rounded-md border border-border bg-surface-2 px-3 py-2 text-[14px] text-ink outline-none focus:border-border-strong'

// Клиентская форма нового issue: валидация заголовка БЕЗ потери тела (никаких server-redirect
// со стиранием текста). Ошибка появляется анимированно (grid 0fr→1fr), без резкого сдвига.
export function NewIssueForm({ owner, slug, lang }: { owner: string; slug: string; lang: Lang }) {
  const [error, setError] = useState(false)
  const titleRef = useRef<HTMLInputElement>(null)

  return (
    <form
      action={createIssue}
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
        <input
          ref={titleRef}
          name="title"
          required
          onChange={() => error && setError(false)}
          className={`${inputCls} ${error ? 'border-danger focus:border-danger' : ''}`}
          placeholder={t('issueTitlePh', lang)}
          autoFocus
          maxLength={200}
        />
        <div className={`grid overflow-hidden transition-all duration-200 ${error ? 'mt-1.5 grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}>
          <p className="min-h-0 overflow-hidden text-[12.5px] text-danger">{t('titleRequired', lang)}</p>
        </div>
      </div>

      <MarkdownEditor name="body" rows={8} placeholder={t('issueBodyPh', lang)} maxLength={20000} lang={lang} refScope={{ owner, slug }} />

      <div>
        <div className="mb-1.5 text-[12px] font-semibold text-ink-2">{t('labelsLabel', lang)}</div>
        <LabelPicker lang={lang} />
      </div>

      <div className="flex justify-end">
        <button className="inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-[13.5px] font-semibold text-primary-fg">
          {t('submitNewIssue', lang)}
        </button>
      </div>
    </form>
  )
}
