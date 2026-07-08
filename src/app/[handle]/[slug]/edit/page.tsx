import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { getSession } from '@/shared/auth/session'
import { getLang } from '@/shared/i18n/server'
import { t, tr } from '@/shared/i18n'
// eslint-disable-next-line no-restricted-imports -- write-доступ (canWriteList) строже просмотра; редиректит не-редакторов
import { getStepPreviews, getTemplateDetail } from '@/features/library/queries'
import { canWriteList } from '@/features/collab/queries'
import { saveNewVersion } from '@/features/library/actions'
import { ListEditor } from '@/features/library/ListEditor'
import { ChangeNoteField } from '@/features/library/ChangeNoteField'
import { toEditorItems } from '@/features/library/editor'

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

  const initial = toEditorItems(steps, lang, await getStepPreviews(steps))
  const action = saveNewVersion.bind(null, tpl.id)

  return (
    <div className="mx-auto w-full max-w-[720px] px-6 py-8">
      <Link
        href={`/${owner}/${slug}`}
        className="mb-4 inline-flex items-center gap-2 text-[13px] text-ink-2 hover:text-ink"
      >
        <ArrowLeft size={15} /> {tpl.owner.handle}/{tpl.slug}
      </Link>

      <form action={action}>
        <h1 className="mb-5 text-[18px] font-bold text-ink">
          {t('edit', lang)} · v{tpl.currentVersion} → v{tpl.currentVersion + 1}
        </h1>

        <ChangeNoteField templateId={tpl.id} lang={lang} placeholder={t('changeNote', lang)} />

        <label className="mb-1.5 block text-[12.5px] font-semibold text-ink-2">{t('tags', lang)}</label>
        <input
          name="tags"
          defaultValue={tpl.tags.join(' ')}
          placeholder={t('tagsHint', lang)}
          className="mb-6 w-full rounded-md border border-border bg-surface-2 px-3 py-2.5 text-[14px] text-ink outline-hidden"
        />

        <label className="mb-1.5 block text-[12.5px] font-semibold text-ink-2">{t('listKind', lang)}</label>
        <div className="mb-6 grid grid-cols-2 gap-2">
          <label className="flex cursor-pointer items-start gap-2.5 rounded-md border border-border bg-surface-2 px-3 py-2.5 has-checked:border-accent">
            <input type="radio" name="ordered" value="ordered" defaultChecked={tpl.ordered} className="mt-0.5" />
            <span>
              <span className="block text-[13.5px] font-medium text-ink">{t('orderedLabel', lang)}</span>
              <span className="block text-[12px] text-ink-2">{t('orderedHint', lang)}</span>
            </span>
          </label>
          <label className="flex cursor-pointer items-start gap-2.5 rounded-md border border-border bg-surface-2 px-3 py-2.5 has-checked:border-accent">
            <input type="radio" name="ordered" value="unordered" defaultChecked={!tpl.ordered} className="mt-0.5" />
            <span>
              <span className="block text-[13.5px] font-medium text-ink">{t('unorderedLabel', lang)}</span>
              <span className="block text-[12px] text-ink-2">{t('unorderedHint', lang)}</span>
            </span>
          </label>
        </div>

        <label className="mb-6 flex cursor-pointer items-start gap-2.5 rounded-md border border-border bg-surface-2 px-3 py-2.5 has-checked:border-accent">
          <input type="checkbox" name="gated" defaultChecked={tpl.gated} className="mt-0.5" />
          <span>
            <span className="block text-[13.5px] font-medium text-ink">{lang === 'ru' ? 'Последовательный курс' : 'Sequential course'}</span>
            <span className="block text-[12px] text-ink-2">{lang === 'ru' ? 'Следующий урок откроется только после сдачи тестов предыдущего' : 'The next lesson unlocks only after passing the previous lesson’s tests'}</span>
          </span>
        </label>

        <label className="mb-2 block text-[12.5px] font-semibold text-ink-2">{lang === 'ru' ? 'Пункты' : 'Items'}</label>
        <ListEditor
          name="items"
          initialItems={initial}
          lang={lang}
          ordered={tpl.ordered}
          aiRefine={{ title: tr(tpl.title, lang), desc: tr(tpl.desc, lang), tags: tpl.tags }}
        />

        <button className="mt-6 rounded-md bg-primary px-5 py-2.5 text-[14px] font-semibold text-primary-fg">
          {t('saveVersion', lang)}
        </button>
      </form>
    </div>
  )
}
