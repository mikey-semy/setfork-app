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
import { ListSettingsSheet } from '@/features/library/ListSettingsSheet'
import { listQuota } from '@/shared/quota'
import { PAGE_NARROW } from '@/shared/ui/control'

export async function generateMetadata() {
  const lang = await getLang()
  return { title: t('newList', lang) }
}

export default async function NewListPage({ searchParams }: { searchParams: Promise<{ e?: string; blocked?: string; step?: string }> }) {
  const [lang, session, sp] = await Promise.all([getLang(), getSession(), searchParams])
  if (!session) redirect('/login')
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
            {t('listQuotaReached', lang).replace('{n}', String(q.limit))}
          </Alert>
        )}

        {/* На экране — только название и пункты. Остальные свойства (описание, теги,
            тип, видимость, курс) заполняют один раз, а места занимали столько же,
            сколько сам редактор, — поэтому они в боковой панели (решение владельца). */}
        <div className="mb-5 flex flex-wrap items-end gap-3">
          <Field label={t('listTitle', lang)} className="min-w-[15rem] flex-1">
            <Input name="title" required placeholder={t('listTitlePh', lang)} className="px-3 py-2.5 text-[0.875rem]" />
          </Field>
          <ListSettingsSheet lang={lang}>
            <Field label={t('listDesc', lang)}>
              <Input name="desc" placeholder={t('listDescPh', lang)} className="px-3 py-2.5 text-[0.875rem]" />
            </Field>

            {/* htmlFor: внутри TagInput чипы с кнопками удаления — оборачивание в label ловило бы их клики. */}
            <Field label={t('tags', lang)} htmlFor="new-tags">
              <TagInput lang={lang} />
            </Field>

            {/* htmlFor: внутри каждого тумблера свои label — вложенные невалидны. */}
            <div className="flex flex-wrap items-end gap-x-4 gap-y-3">
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
          </ListSettingsSheet>
        </div>

        <label className="mb-2 block text-[0.78125rem] font-semibold text-ink-2">{t('listItems', lang)}</label>
        <ListEditor name="items" initialItems={[]} lang={lang} aiRefine={{ title: '', desc: '', tags: [] }} />

        <SubmitButton className="mt-6">{t('listCreate', lang)}</SubmitButton>
      </form>
    </div>
  )
}
