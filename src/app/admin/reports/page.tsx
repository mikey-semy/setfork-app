import { requireAdmin } from '@/shared/auth/admin'
import { getLang } from '@/shared/i18n/server'
import { t } from '@/shared/i18n'
import { PageHeader } from '@/shared/ui/PageHeader'
import { getReportsCounts, getReportsList, type ReportFilter } from '@/features/reports/queries'
import { ReportsTable } from '@/features/reports/ReportsTable'

export const metadata = { title: 'Reports' }

export default async function AdminReportsPage({ searchParams }: { searchParams: Promise<{ filter?: string }> }) {
  await requireAdmin()
  const [{ filter: f }, lang] = await Promise.all([searchParams, getLang()])
  const filter: ReportFilter =
    f === 'new' || f === 'reviewed' || f === 'actioned' || f === 'dismissed' ? f : 'all'
  const [items, counts] = await Promise.all([getReportsList(filter), getReportsCounts()])

  return (
    <div className="mx-auto w-full max-w-[860px] px-6 py-8">
      <PageHeader title={t('reports', lang)} subtitle={t('reportsAdminIntro', lang)} />
      <ReportsTable items={items} counts={counts} filter={filter} lang={lang} />
    </div>
  )
}
