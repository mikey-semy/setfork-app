import { notFound, redirect } from 'next/navigation'
import { CircleDot } from 'lucide-react'
import { getSession } from '@/shared/auth/session'
import { getLang } from '@/shared/i18n/server'
import { t } from '@/shared/i18n'
import { PageHeader } from '@/shared/ui/PageHeader'
import { FloatingBack } from '@/shared/ui/FloatingBack'
import { requireViewableMeta } from '@/features/library/guard'
import { NewIssueForm } from '@/features/issues/NewIssueForm'
import { getListLabels } from '@/features/issues/queries'
import { PAGE_NARROW } from '@/shared/ui/control'
import { isFeatureEnabled } from '@/core'

export async function generateMetadata({ params }: { params: Promise<{ handle: string; slug: string }> }) {
  const [{ handle, slug }, lang] = await Promise.all([params, getLang()])
  return { title: `${t('newIssue', lang)} · ${handle}/${slug}` }
}

export default async function NewIssuePage({ params }: { params: Promise<{ handle: string; slug: string }> }) {
  const [{ handle: owner, slug }, lang, session] = await Promise.all([params, getLang(), getSession()])
  if (!session) redirect(`/login?next=/${owner}/${slug}/issues/new`)
  const meta = await requireViewableMeta(owner, slug)
  if (!meta) notFound()
  // Тот же предикат, что у записи (canWriteToFeature): страница отражает решение
  // владельца, но не заменяет его — проверка живёт в actions.
  if (!isFeatureEnabled(meta, 'issues')) notFound() // раздел выключен (Settings → Features)
  const custom = await getListLabels(meta.id)

  return (
    <>
      <div className={PAGE_NARROW}>
      <FloatingBack href={`/${owner}/${slug}/issues`} label={t('issuesTab', lang)} />
        <PageHeader icon={<CircleDot size={18} className="text-ok" />} title={t('newIssue', lang)} />
        <NewIssueForm owner={owner} slug={slug} lang={lang} custom={custom} />
      </div>
    </>
  )
}
