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
import { ListEditor } from '@/features/library/list-editor/ListEditor'
import { GatedToggle, ListTypeToggle, VisibilityToggle } from '@/features/library/ListFormToggles'
import { listQuota } from '@/shared/quota'
import { PAGE_NARROW } from '@/shared/ui/control'

export async function generateMetadata() {
  const lang = await getLang()
  return { title: t('newList', lang) }
}

export default async function NewListPage({ searchParams }: { searchParams: Promise<{ e?: string; blocked?: string; step?: string }> }) {
  const [lang, session, sp] = await Promise.all([getLang(), getSession(), searchParams])
  if (!session) redirect('/login')
  const ru = lang === 'ru'
  const quotaHit = sp.e === 'list_quota'
  const q = quotaHit ? await listQuota(session.userId, session.handle) : null

  return (
    <div className={PAGE_NARROW}>
      <FloatingBack href={'/my-lists'} label={t('myLists', lang)} />
      <form action={createTemplate}>
        {/* Название страницы уже стоит в шапке приложения. */}
        <PageHeader hideTitle title={t('newList', lang)} />

        {/* Отказ стража исполняемых команд: причина словами и номер шага — иначе
            кнопка «Создать» выглядит сломанной. */}
        {sp.blocked && (
          <Alert variant="danger" className="mb-5">
            <span className="block font-semibold">{t('destructiveBlockedTitle', lang)}</span>
            <span className="block">
              {t('destructiveBlockedBody', lang)
                .replace('{n}', sp.step ?? '?')
                .replace('{reason}', t(`destructive.${sp.blocked}` as Parameters<typeof t>[0], lang))}
            </span>
          </Alert>
        )}

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

        {/* Тип, видимость и режим курса — один ряд: в каждом выбор из двух состояний,
            а тремя карточками в столбик они занимали пол-экрана телефона.
            htmlFor: внутри каждого тумблера свои label — вложенные невалидны. */}
        <div className="mb-6 flex flex-wrap items-end gap-x-4 gap-y-3">
          <Field label={t('listKind', lang)} htmlFor="new-kind">
            <ListTypeToggle ordered lang={lang} />
          </Field>
          <Field label={t('visibility', lang)} htmlFor="new-visibility">
            <VisibilityToggle isPublic lang={lang} />
          </Field>
          <Field label={t('gatedShort', lang)} htmlFor="new-gated">
            <GatedToggle gated={false} lang={lang} />
          </Field>
        </div>

        <label className="mb-2 block text-[0.78125rem] font-semibold text-ink-2">{ru ? 'Пункты' : 'Items'}</label>
        <ListEditor name="items" initialItems={[]} lang={lang} aiRefine={{ title: '', desc: '', tags: [] }} />

        <SubmitButton className="mt-6">
          {ru ? 'Создать список' : 'Create list'}
        </SubmitButton>
      </form>
    </div>
  )
}
