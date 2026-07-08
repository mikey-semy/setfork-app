import { notFound, redirect } from 'next/navigation'
import { CircleDot } from 'lucide-react'
import { getSession } from '@/shared/auth/session'
import { getLang } from '@/shared/i18n/server'
import { t } from '@/shared/i18n'
import { requireViewableMeta } from '@/features/library/guard'
import { ListHeader } from '@/widgets/ListHeader'
import { NewIssueForm } from '@/features/issues/NewIssueForm'
import { getListLabels } from '@/features/issues/queries'

export default async function NewIssuePage({ params }: { params: Promise<{ handle: string; slug: string }> }) {
  const { handle: owner, slug } = await params
  const [lang, session] = await Promise.all([getLang(), getSession()])
  if (!session) redirect(`/login?next=/${owner}/${slug}/issues/new`)
  const meta = await requireViewableMeta(owner, slug)
  if (!meta) notFound()
  const custom = await getListLabels(meta.id)

  return (
    <>
      <ListHeader owner={owner} slug={slug} active="issues" />
      <div className="mx-auto w-full max-w-[820px] px-4 py-6">
        <h1 className="mb-4 flex items-center gap-2 text-[17px] font-bold text-ink">
          <CircleDot size={18} className="text-ok" /> {t('newIssue', lang)}
        </h1>
        <NewIssueForm owner={owner} slug={slug} lang={lang} custom={custom} />
      </div>
    </>
  )
}
