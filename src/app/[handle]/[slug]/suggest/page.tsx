import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { getSession } from '@/shared/auth/session'
import { getLang } from '@/shared/i18n/server'
import { t, tr } from '@/shared/i18n'
import { getStepPreviews, getTemplateDetail } from '@/features/library/queries'
import { submitSuggestion } from '@/features/library/actions'
import { ListEditor } from '@/features/library/ListEditor'
import { ChangeNoteField } from '@/features/library/ChangeNoteField'
import { toEditorItems } from '@/features/library/editor'

export default async function SuggestPage({
  params,
}: {
  params: Promise<{ handle: string; slug: string }>
}) {
  const { handle: owner, slug } = await params
  const [lang, session] = await Promise.all([getLang(), getSession()])
  if (!session) redirect('/login')
  const detail = await getTemplateDetail(owner, slug)
  if (!detail) notFound()
  const { tpl, steps } = detail
  if (tpl.visibility === 'private' && session.userId !== tpl.ownerId) notFound()

  const initial = toEditorItems(steps, lang, await getStepPreviews(steps))
  const action = submitSuggestion.bind(null, tpl.id)

  return (
    <div className="mx-auto w-full max-w-[720px] px-6 py-8">
      <Link
        href={`/${owner}/${slug}`}
        className="mb-4 inline-flex items-center gap-2 text-[13px] text-ink-2 hover:text-ink"
      >
        <ArrowLeft size={15} /> {tpl.owner.handle}/{tpl.slug}
      </Link>

      <form action={action}>
        <h1 className="mb-1 text-[18px] font-bold text-ink">{t('suggestEdit', lang)}</h1>
        <p className="mb-5 text-[13px] text-ink-2">
          {lang === 'ru'
            ? 'Правь пункты. Автор списка примет правку новой версией или отклонит.'
            : 'Edit the items. The maintainer will accept it as a new version or reject it.'}
        </p>

        <div className="mb-6">
          <ChangeNoteField templateId={tpl.id} lang={lang} placeholder={t('changeNote', lang)} />
        </div>

        <ListEditor name="items" initialItems={initial} lang={lang} />

        <button className="mt-6 rounded-md bg-primary px-5 py-2.5 text-[14px] font-semibold text-primary-fg">
          {t('sendSuggestion', lang)}
        </button>
      </form>
    </div>
  )
}
