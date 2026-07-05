import { redirect } from 'next/navigation'
import { getSession } from '@/shared/auth/session'
import { getLang } from '@/shared/i18n/server'
import { t } from '@/shared/i18n'
import { Input } from '@/shared/ui/input'
import { SubmitButton } from '@/shared/ui/SubmitButton'
import { createTemplate } from '@/features/library/actions'
import { ListEditor } from '@/features/library/ListEditor'

export default async function NewListPage() {
  const [lang, session] = await Promise.all([getLang(), getSession()])
  if (!session) redirect('/login')
  const ru = lang === 'ru'

  return (
    <div className="mx-auto w-full max-w-[720px] px-6 py-8">
      <form action={createTemplate}>
        <h1 className="mb-6 text-[18px] font-bold text-ink">{t('newList', lang)}</h1>

        <label className="mb-1.5 block text-[12.5px] font-semibold text-ink-2">{ru ? 'Название' : 'Title'}</label>
        <Input
          name="title"
          required
          placeholder={ru ? 'напр. Деплой на VPS' : 'e.g. Deploy to a VPS'}
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
        <Input
          name="tags"
          placeholder={ru ? 'напр. docker deploy vps' : 'e.g. docker deploy vps'}
          className="mb-6 px-3 py-2.5 text-[14px]"
        />

        <label className="mb-1.5 block text-[12.5px] font-semibold text-ink-2">{t('listKind', lang)}</label>
        <div className="mb-6 grid grid-cols-2 gap-2">
          <label className="flex cursor-pointer items-start gap-2.5 rounded-md border border-border bg-surface-2 px-3 py-2.5 has-[:checked]:border-accent">
            <input type="radio" name="ordered" value="ordered" defaultChecked className="mt-0.5" />
            <span>
              <span className="block text-[13.5px] font-medium text-ink">{t('orderedLabel', lang)}</span>
              <span className="block text-[12px] text-ink-2">{t('orderedHint', lang)}</span>
            </span>
          </label>
          <label className="flex cursor-pointer items-start gap-2.5 rounded-md border border-border bg-surface-2 px-3 py-2.5 has-[:checked]:border-accent">
            <input type="radio" name="ordered" value="unordered" className="mt-0.5" />
            <span>
              <span className="block text-[13.5px] font-medium text-ink">{t('unorderedLabel', lang)}</span>
              <span className="block text-[12px] text-ink-2">{t('unorderedHint', lang)}</span>
            </span>
          </label>
        </div>

        <label className="mb-1.5 block text-[12.5px] font-semibold text-ink-2">{t('visibility', lang)}</label>
        <div className="mb-6 flex flex-col gap-2">
          <label className="flex cursor-pointer items-start gap-2.5 rounded-md border border-border bg-surface-2 px-3 py-2.5 has-[:checked]:border-accent">
            <input type="radio" name="visibility" value="public" defaultChecked className="mt-0.5" />
            <span>
              <span className="block text-[13.5px] font-medium text-ink">{t('publicLabel', lang)}</span>
              <span className="block text-[12px] text-ink-2">{t('publicHint', lang)}</span>
            </span>
          </label>
          <label className="flex cursor-pointer items-start gap-2.5 rounded-md border border-border bg-surface-2 px-3 py-2.5 has-[:checked]:border-accent">
            <input type="radio" name="visibility" value="private" className="mt-0.5" />
            <span>
              <span className="block text-[13.5px] font-medium text-ink">{t('privateLabel', lang)}</span>
              <span className="block text-[12px] text-ink-2">{t('privateHint', lang)}</span>
            </span>
          </label>
        </div>

        <label className="mb-2 block text-[12.5px] font-semibold text-ink-2">{ru ? 'Пункты' : 'Items'}</label>
        <ListEditor name="items" initialItems={[]} lang={lang} aiRefine={{ title: '', desc: '', tags: [] }} />

        <SubmitButton className="mt-6 rounded-md bg-primary px-5 py-2.5 text-[14px] font-semibold text-primary-fg">
          {ru ? 'Создать список' : 'Create list'}
        </SubmitButton>
      </form>
    </div>
  )
}
