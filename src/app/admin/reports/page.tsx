import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { requireAdmin } from '@/shared/auth/admin'
import { getLang } from '@/shared/i18n/server'
import { t } from '@/shared/i18n'
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
      <Link href="/admin" className="mb-4 inline-flex items-center gap-2 text-[13px] text-ink-2 hover:text-ink">
        <ArrowLeft size={15} /> Admin
      </Link>
      <h1 className="mb-1 text-[18px] font-bold text-ink">{t('reports', lang)}</h1>
      <p className="mb-5 text-[13px] text-ink-2">{t('reportsAdminIntro', lang)}</p>
      <ReportsTable items={items} counts={counts} filter={filter} lang={lang} />
    </div>
  )
}
