import type { ReactNode } from 'react'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { Code2, List } from 'lucide-react'
import { getLang } from '@/shared/i18n/server'
import { t, type Lang } from '@/shared/i18n'
import { Markdown } from '@/shared/ui/Markdown'
import { PageHeader } from '@/shared/ui/PageHeader'
import { StepLevelBadge } from '@/shared/ui/StepLevelBadge'
import { VersionPicker } from '@/features/library/VersionPicker'
import { getVersions, getVersionSteps } from '@/features/library/queries'
import { requireViewableMeta } from '@/features/library/guard'
import { HistoryNav } from '@/widgets/HistoryNav'
import { safeHref } from '@/shared/lib/safe-url'
import { rowsToCmp } from '@/features/library/diff'
import { CodeDiff, ListDiff } from '@/features/library/DiffViews'
import { PAGE } from '@/shared/ui/control'


export async function generateMetadata({ params }: { params: Promise<{ handle: string; slug: string }> }) {
  const [{ handle, slug }, lang] = await Promise.all([params, getLang()])
  return { title: `${t('compareTitle', lang)} · ${handle}/${slug}` }
}

export default async function ComparePage({
  params,
  searchParams,
}: {
  params: Promise<{ handle: string; slug: string }>
  searchParams: Promise<{ from?: string; to?: string; view?: string }>
}) {
  const [{ handle: owner, slug }, sp, lang] = await Promise.all([params, searchParams, getLang()])
  const meta = await requireViewableMeta(owner, slug)
  if (!meta) notFound()

  const view = sp.view === 'list' ? 'list' : 'code'
  const versions = await getVersions(meta.id)
  const nums = versions.map((v) => v.version).sort((a, b) => a - b)
  // Нечего сравнивать при одной версии — отправляем на историю версий (URL достижим напрямую).
  if (nums.length < 2) redirect(`/${owner}/${slug}/versions`)
  const toN = Math.min(Number(sp.to) || meta.currentVersion, meta.currentVersion)
  const fromN = Math.max(Number(sp.from) || Math.max(nums[0], toN - 1), nums[0])

  const [fromV, toV] = await Promise.all([getVersionSteps(meta.id, fromN), getVersionSteps(meta.id, toN)])
  if (!fromV || !toV) notFound()
  const fromSteps = rowsToCmp(fromV.steps, lang)
  const toSteps = rowsToCmp(toV.steps, lang)

  const base = `/${owner}/${slug}/compare`
  const toggle = (key: 'code' | 'list', icon: ReactNode, labelKey: 'viewCode' | 'viewList') => (
    <Link
      href={`${base}?from=${fromN}&to=${toN}&view=${key}`}
      className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[0.78125rem] font-medium ${
        view === key ? 'bg-primary text-primary-fg' : 'text-ink-2 hover:text-ink'
      }`}
    >
      {icon} {t(labelKey, lang)}
    </Link>
  )

  return (
    <>
      <div className={PAGE}>
        <HistoryNav
          base={`/${owner}/${slug}`}
          active="compare"
          canCompare
          labels={{ commits: t('versionsTab', lang), releases: t('releasesLabel', lang), compare: t('compareTitle', lang) }}
        />
        <PageHeader
          size="section"
          title={t('compareTitle', lang)}
          actions={
            <div className="flex items-center gap-1 rounded-md border border-border bg-surface-2 p-0.5">
              {toggle('code', <Code2 size={14} />, 'viewCode')}
              {toggle('list', <List size={14} />, 'viewList')}
            </div>
          }
        />

        <div className="mb-4">
          <VersionPicker
            base={base}
            versions={nums}
            from={fromN}
            to={toN}
            view={view}
            fromLabel={`${t('diffFrom', lang)}:`}
            toLabel={`${t('diffTo', lang)}:`}
            swapLabel={t('swapVersions', lang)}
          />
        </div>

        {view === 'code' ? (
          <CodeDiff fromSteps={fromSteps} toSteps={toSteps} ordered={meta.ordered} lang={lang} />
        ) : (
          <ListDiff fromSteps={fromSteps} toSteps={toSteps} lang={lang} />
        )}
      </div>
    </>
  )
}
