import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { getSession } from '@/shared/auth/session'
import { getLang } from '@/shared/i18n/server'
import { t } from '@/shared/i18n'
import { getTemplateDetail } from '@/features/library/queries'
import { saveNewVersion } from '@/features/library/actions'
import { ListEditor } from '@/features/library/ListEditor'
import { toEditorItems } from '@/features/library/editor'

export default async function EditPage({
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
  if (tpl.ownerId !== session.userId) redirect(`/${owner}/${slug}`)

  const initial = toEditorItems(steps, lang)
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

        <input
          name="note"
          placeholder={t('changeNote', lang)}
          className="mb-6 w-full rounded-md border border-border bg-surface-2 px-3 py-2.5 text-[14px] text-ink outline-none"
        />

        <ListEditor name="items" initialItems={initial} lang={lang} />

        <button className="mt-6 rounded-md bg-primary px-5 py-2.5 text-[14px] font-semibold text-primary-fg">
          {t('saveVersion', lang)}
        </button>
      </form>
    </div>
  )
}
