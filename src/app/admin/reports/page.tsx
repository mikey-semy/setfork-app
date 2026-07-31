import { requireAdmin } from '@/shared/auth/admin'
import { getLang } from '@/shared/i18n/server'
import { t } from '@/shared/i18n'
import { PageHeader } from '@/shared/ui/PageHeader'
import { getReportsCounts, getReportsList, type ReportFilter } from '@/features/reports/queries'
import { ReportsTable } from '@/features/reports/ReportsTable'

export async function generateMetadata() {
  const lang = await getLang()
  return { title: t('reports', lang) }
}

export default async function AdminReportsPage({ searchParams }: { searchParams: Promise<{ filter?: string }> }) {
  await requireAdmin()
  const [{ filter: f }, lang] = await Promise.all([searchParams, getLang()])
  const filter: ReportFilter =
    f === 'new' || f === 'reviewed' || f === 'actioned' || f === 'dismissed' ? f : 'all'
  const [items, counts] = await Promise.all([getReportsList(filter), getReportsCounts()])

  return (
    <div className="mx-auto w-full max-w-[53.75rem] px-6 py-8">
      <PageHeader title={t('reports', lang)} subtitle={t('reportsAdminIntro', lang)} />
      <ReportsTable items={items} counts={counts} filter={filter} lang={lang} />
    </div>
  )
}
