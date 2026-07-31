import { redirect } from 'next/navigation'
import { getSession } from '@/shared/auth/session'
import { getLang } from '@/shared/i18n/server'
import { t } from '@/shared/i18n'
import { Input } from '@/shared/ui/input'
import { TagInput } from '@/shared/ui/TagInput'
import { SubmitButton } from '@/shared/ui/SubmitButton'
import { createTemplate } from '@/features/library/actions'
import { ListEditor } from '@/features/library/ListEditor'
import { ListTypeToggle } from '@/features/library/ListTypeToggle'
import { listQuota } from '@/shared/quota'

export const metadata = { title: 'New list' }

export default async function NewListPage({ searchParams }: { searchParams: Promise<{ e?: string }> }) {
  const [lang, session, sp] = await Promise.all([getLang(), getSession(), searchParams])
  if (!session) redirect('/login')
  const ru = lang === 'ru'
  const quotaHit = sp.e === 'list_quota'
  const q = quotaHit ? await listQuota(session.userId, session.handle) : null

  return (
    <div className="mx-auto w-full max-w-[720px] px-6 py-8">
      <form action={createTemplate}>
        <h1 className="mb-6 text-[18px] font-bold text-ink">{t('newList', lang)}</h1>

        {quotaHit && q && (
          <div className="mb-5 rounded-md border border-warn/50 bg-surface px-3 py-2.5 text-[13px] text-warn">
            {ru
              ? `Достигнут лимит списков (${q.limit}). Удали ненужные, чтобы создать новый.`
              : `You’ve reached the list limit (${q.limit}). Delete some to create a new one.`}
          </div>
        )}

        <label className="mb-1.5 block text-[12.5px] font-semibold text-ink-2">{ru ? 'Название' : 'Title'}</label>
        <Input
          name="title"
          required
          placeholder={ru ? 'Деплой на VPS' : 'Deploy to a VPS'}
          className="mb-5 px-3 py-2.5 text-[14px]"
        />

        <label className="mb-1.5 block text-[12.5px] font-semibold text-ink-2">
          {ru ? 'Описание' : 'Description'}
        </label>
        <Input
          name="desc"
          placeholder={ru ? 'Коротко, о чём список' : 'One line about the list'}
          className="mb-5 px-3 py-2.5 text-[14px]"
        />

        <label className="mb-1.5 block text-[12.5px] font-semibold text-ink-2">{t('tags', lang)}</label>
        <div className="mb-6">
          <TagInput lang={lang} />
        </div>

        <label className="mb-1.5 block text-[12.5px] font-semibold text-ink-2">{t('listKind', lang)}</label>
        <div className="mb-6">
          <ListTypeToggle ordered lang={lang} />
        </div>

        <label className="mb-1.5 block text-[12.5px] font-semibold text-ink-2">{t('visibility', lang)}</label>
        <div className="mb-6 flex flex-col gap-2">
          <label className="flex cursor-pointer items-start gap-2.5 rounded-md border border-border bg-surface-2 px-3 py-2.5 has-checked:border-accent">
            <input type="radio" name="visibility" value="public" defaultChecked className="mt-0.5" />
            <span>
              <span className="block text-[13.5px] font-medium text-ink">{t('publicLabel', lang)}</span>
              <span className="block text-[12px] text-ink-2">{t('publicHint', lang)}</span>
            </span>
          </label>
          <label className="flex cursor-pointer items-start gap-2.5 rounded-md border border-border bg-surface-2 px-3 py-2.5 has-checked:border-accent">
            <input type="radio" name="visibility" value="private" className="mt-0.5" />
            <span>
              <span className="block text-[13.5px] font-medium text-ink">{t('privateLabel', lang)}</span>
              <span className="block text-[12px] text-ink-2">{t('privateHint', lang)}</span>
            </span>
          </label>
        </div>

        <label className="mb-6 flex cursor-pointer items-start gap-2.5 rounded-md border border-border bg-surface-2 px-3 py-2.5 has-checked:border-accent">
          <input type="checkbox" name="gated" className="mt-0.5" />
          <span>
            <span className="block text-[13.5px] font-medium text-ink">{ru ? 'Последовательный курс' : 'Sequential course'}</span>
            <span className="block text-[12px] text-ink-2">{ru ? 'Следующий урок откроется только после сдачи тестов предыдущего' : 'The next lesson unlocks only after passing the previous lesson’s tests'}</span>
          </span>
        </label>

        <label className="mb-2 block text-[12.5px] font-semibold text-ink-2">{ru ? 'Пункты' : 'Items'}</label>
        <ListEditor name="items" initialItems={[]} lang={lang} aiRefine={{ title: '', desc: '', tags: [] }} />

        <SubmitButton className="mt-6">
          {ru ? 'Создать список' : 'Create list'}
        </SubmitButton>
      </form>
    </div>
  )
}
