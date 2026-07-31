import { notFound, redirect } from 'next/navigation'
import { CircleDot } from 'lucide-react'
import { getSession } from '@/shared/auth/session'
import { getLang } from '@/shared/i18n/server'
import { t } from '@/shared/i18n'
import { PageHeader } from '@/shared/ui/PageHeader'
import { requireViewableMeta } from '@/features/library/guard'
import { NewIssueForm } from '@/features/issues/NewIssueForm'
import { getListLabels } from '@/features/issues/queries'

export async function generateMetadata({ params }: { params: Promise<{ handle: string; slug: string }> }) {
  const { handle, slug } = await params
  return { title: `New issue · ${handle}/${slug}` }
}

export default async function NewIssuePage({ params }: { params: Promise<{ handle: string; slug: string }> }) {
  const [{ handle: owner, slug }, lang, session] = await Promise.all([params, getLang(), getSession()])
  if (!session) redirect(`/login?next=/${owner}/${slug}/issues/new`)
  const meta = await requireViewableMeta(owner, slug)
  if (!meta) notFound()
  if (!meta.issuesEnabled) notFound() // раздел выключен владельцем (Settings → Features)
  const custom = await getListLabels(meta.id)

  return (
    <>
      <div className="mx-auto w-full max-w-[51.25rem] px-4 py-6">
        <PageHeader icon={<CircleDot size={18} className="text-ok" />} title={t('newIssue', lang)} />
        <NewIssueForm owner={owner} slug={slug} lang={lang} custom={custom} />
      </div>
    </>
  )
}
