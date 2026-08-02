import { redirect } from 'next/navigation'
import { getSession } from '@/shared/auth/session'
import { getLang } from '@/shared/i18n/server'
import { t } from '@/shared/i18n'
import { Input } from '@/shared/ui/input'
import { TagInput } from '@/shared/ui/TagInput'
import { Field } from '@/shared/ui/Field'
import { Alert } from '@/shared/ui/Alert'
import { SubmitButton } from '@/shared/ui/SubmitButton'
import { PageHeader } from '@/shared/ui/PageHeader'
import { FloatingBack } from '@/shared/ui/FloatingBack'
import { createTemplate } from '@/features/library/actions'
import { ListEditor } from '@/features/library/ListEditor'
import { ListTypeToggle } from '@/features/library/ListTypeToggle'
import { listQuota } from '@/shared/quota'
import { PAGE_NARROW } from '@/shared/ui/control'

export async function generateMetadata() {
  const lang = await getLang()
  return { title: t('newList', lang) }
}

export default async function NewListPage({ searchParams }: { searchParams: Promise<{ e?: string }> }) {
  const [lang, session, sp] = await Promise.all([getLang(), getSession(), searchParams])
  if (!session) redirect('/login')
  const ru = lang === 'ru'
  const quotaHit = sp.e === 'list_quota'
  const q = quotaHit ? await listQuota(session.userId, session.handle) : null

  return (
    <div className={PAGE_NARROW}>
      <FloatingBack href={'/my-lists'} label={t('myLists', lang)} />
      <form action={createTemplate}>
        <PageHeader title={t('newList', lang)} />

        {quotaHit && q && (
          <Alert variant="warn" className="mb-5">
            {ru
              ? `Достигнут лимит списков (${q.limit}). Удали ненужные, чтобы создать новый.`
              : `You’ve reached the list limit (${q.limit}). Delete some to create a new one.`}
          </Alert>
        )}

        <Field label={ru ? 'Название' : 'Title'} className="mb-5">
          <Input
            name="title"
            required
            placeholder={ru ? 'Деплой на VPS' : 'Deploy to a VPS'}
            className="px-3 py-2.5 text-[0.875rem]"
          />
        </Field>

        <Field label={ru ? 'Описание' : 'Description'} className="mb-5">
          <Input
            name="desc"
            placeholder={ru ? 'Коротко, о чём список' : 'One line about the list'}
            className="px-3 py-2.5 text-[0.875rem]"
          />
        </Field>

        {/* htmlFor: внутри TagInput чипы с кнопками удаления — оборачивание в label ловило бы их клики. */}
        <Field label={t('tags', lang)} htmlFor="new-tags" className="mb-6">
          <TagInput lang={lang} />
        </Field>

        {/* htmlFor: тумблер типа — группа кнопок, не одиночный контрол. */}
        <Field label={t('listKind', lang)} htmlFor="new-kind" className="mb-6">
          <ListTypeToggle ordered lang={lang} />
        </Field>

        {/* htmlFor: внутри радио-карточки со своими label — вложенные label невалидны. */}
        <Field label={t('visibility', lang)} htmlFor="new-visibility" className="mb-6">
          <div className="flex flex-col gap-2">
          <label className="flex cursor-pointer items-start gap-2.5 rounded-md border border-border bg-surface-2 px-3 py-2.5 has-checked:border-accent">
            <input type="radio" name="visibility" value="public" defaultChecked className="mt-0.5" />
            <span>
              <span className="block text-[0.8125rem] font-medium text-ink">{t('publicLabel', lang)}</span>
              <span className="block text-[0.78125rem] text-ink-2">{t('publicHint', lang)}</span>
            </span>
          </label>
          <label className="flex cursor-pointer items-start gap-2.5 rounded-md border border-border bg-surface-2 px-3 py-2.5 has-checked:border-accent">
            <input type="radio" name="visibility" value="private" className="mt-0.5" />
            <span>
              <span className="block text-[0.8125rem] font-medium text-ink">{t('privateLabel', lang)}</span>
              <span className="block text-[0.78125rem] text-ink-2">{t('privateHint', lang)}</span>
            </span>
          </label>
          </div>
        </Field>

        <label className="mb-6 flex cursor-pointer items-start gap-2.5 rounded-md border border-border bg-surface-2 px-3 py-2.5 has-checked:border-accent">
          <input type="checkbox" name="gated" className="mt-0.5" />
          <span>
            <span className="block text-[0.8125rem] font-medium text-ink">{ru ? 'Последовательный курс' : 'Sequential course'}</span>
            <span className="block text-[0.78125rem] text-ink-2">{ru ? 'Следующий урок откроется только после сдачи тестов предыдущего' : 'The next lesson unlocks only after passing the previous lesson’s tests'}</span>
          </span>
        </label>

        <label className="mb-2 block text-[0.78125rem] font-semibold text-ink-2">{ru ? 'Пункты' : 'Items'}</label>
        <ListEditor name="items" initialItems={[]} lang={lang} aiRefine={{ title: '', desc: '', tags: [] }} />

        <SubmitButton className="mt-6">
          {ru ? 'Создать список' : 'Create list'}
        </SubmitButton>
      </form>
    </div>
  )
}
