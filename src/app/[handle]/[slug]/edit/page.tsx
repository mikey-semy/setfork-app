import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { getSession } from '@/shared/auth/session'
import { getLang } from '@/shared/i18n/server'
import { t, tr } from '@/shared/i18n'
// eslint-disable-next-line no-restricted-imports -- write-доступ (canWriteList) строже просмотра; редиректит не-редакторов
import { getStepPreviews, getTemplateDetail } from '@/features/library/queries'
import { canWriteList } from '@/features/collab/queries'
import { canEditList } from '@/core'
import { saveNewVersion } from '@/features/library/actions'
import { ListEditor } from '@/features/library/ListEditor'
import { ListTypeToggle } from '@/features/library/ListTypeToggle'
import { TagInput } from '@/shared/ui/TagInput'
import { Field } from '@/shared/ui/Field'
import { ChangeNoteField } from '@/features/library/ChangeNoteField'
import { toEditorItems } from '@/features/library/editor'
import { FloatingBack } from '@/shared/ui/FloatingBack'
import { PageHeader } from '@/shared/ui/PageHeader'
import { PAGE } from '@/shared/ui/control'

export async function generateMetadata({ params }: { params: Promise<{ handle: string; slug: string }> }) {
  const [{ handle, slug }, lang] = await Promise.all([params, getLang()])
  return { title: `${t('edit', lang)} · ${handle}/${slug}` }
}

export default async function EditPage({
  params,
}: {
  params: Promise<{ handle: string; slug: string }>
}) {
  const [{ handle: owner, slug }, lang, session] = await Promise.all([params, getLang(), getSession()])
  if (!session) redirect('/login')
  const detail = await getTemplateDetail(owner, slug)
  if (!detail) notFound()
  const { tpl, steps } = detail
  if (!(await canWriteList(tpl.id, tpl.ownerId, session.userId))) redirect(`/${owner}/${slug}`)
  // Архив/заморозка: редактор недоступен (список только-чтение). Разблокировать —
  // разархивировать/разморозить в настройках. Баннер причины покажет сама страница.
  if (!canEditList(tpl)) redirect(`/${owner}/${slug}`)

  const initial = toEditorItems(steps, lang, await getStepPreviews(steps))
  const action = saveNewVersion.bind(null, tpl.id)

  return (
    <div className={PAGE}>
      <Link
        href={`/${owner}/${slug}`}
        className="mb-4 inline-flex items-center gap-2 text-[0.8125rem] text-ink-2 hover:text-ink"
      >
        <ArrowLeft size={15} /> {tpl.owner.handle} / {tr(tpl.title, lang) || tpl.slug}
      </Link>
      {/* На длинном списке верхняя ссылка уезжает — плавающий дубль слева-внизу (фидбек владельца). */}
      <FloatingBack href={`/${owner}/${slug}`} label={tr(tpl.title, lang) || `${tpl.owner.handle}/${tpl.slug}`} />

      <form action={action}>
        <PageHeader
          title={
            <>
              {t('edit', lang)} · v{tpl.currentVersion} → v{tpl.currentVersion + 1}
            </>
          }
        />

        <ChangeNoteField templateId={tpl.id} lang={lang} placeholder={t('changeNote', lang)} />

        {/* htmlFor: внутри TagInput чипы с кнопками удаления — оборачивание в label ловило бы их клики. */}
        <Field label={t('tags', lang)} htmlFor="edit-tags" className="mb-6">
          <TagInput initial={tpl.tags} lang={lang} />
        </Field>

        {/* htmlFor: тумблер типа — группа кнопок, не одиночный контрол. */}
        <Field label={t('listKind', lang)} htmlFor="edit-kind" className="mb-6">
          <ListTypeToggle ordered={tpl.ordered} lang={lang} />
        </Field>

        <label className="mb-6 flex cursor-pointer items-start gap-2.5 rounded-md border border-border bg-surface-2 px-3 py-2.5 has-checked:border-accent">
          <input type="checkbox" name="gated" defaultChecked={tpl.gated} className="mt-0.5" />
          <span>
            <span className="block text-[0.8125rem] font-medium text-ink">{lang === 'ru' ? 'Последовательный курс' : 'Sequential course'}</span>
            <span className="block text-[0.78125rem] text-ink-2">{lang === 'ru' ? 'Следующий урок откроется только после сдачи тестов предыдущего' : 'The next lesson unlocks only after passing the previous lesson’s tests'}</span>
          </span>
        </label>

        <label className="mb-2 block text-[0.78125rem] font-semibold text-ink-2">{lang === 'ru' ? 'Пункты' : 'Items'}</label>
        <ListEditor
          name="items"
          initialItems={initial}
          lang={lang}
          ordered={tpl.ordered}
          aiRefine={{ title: tr(tpl.title, lang), desc: tr(tpl.desc, lang), tags: tpl.tags }}
        />

        <button type="submit" className="mt-6 rounded-md bg-primary px-5 py-2.5 text-[0.875rem] font-semibold text-primary-fg">
          {t('saveVersion', lang)}
        </button>
      </form>
    </div>
  )
}
