import { desc } from 'drizzle-orm'
import { Sparkles } from 'lucide-react'
import { requireAdmin } from '@/shared/auth/admin'
import { db, proInterest } from '@/shared/db'
import { getLang } from '@/shared/i18n/server'
import { t } from '@/shared/i18n'
import { PAGE } from '@/shared/ui/control'
import { PageHeader } from '@/shared/ui/PageHeader'
import { EmptyState } from '@/shared/ui/EmptyState'
import { countProInterest } from '@/features/monetization/queries'

/**
 * ЗАЯВКИ «ХОЧУ PRO» — витрина замера спроса (решение 0021).
 *
 * ⚠️ ГЛАВНОЕ ЧИСЛО ЗДЕСЬ — СКОЛЬКО ЛЮДЕЙ, а не сколько строк. Порог смены курса назван
 * заранее (≥ 20 заявок), и считать одного человека, нажавшего дважды, за две заявки
 * значило бы принять решение о платёжке по собственному шуму.
 *
 * Источник (у какого ограничения нажали) показывается рядом: он отвечает на второй
 * вопрос — не «хотят ли платить вообще», а «за что именно».
 */
export default async function AdminProInterestPage() {
  await requireAdmin()
  const [lang, rows, people] = await Promise.all([
    getLang(),
    db.select().from(proInterest).orderBy(desc(proInterest.createdAt)).limit(200),
    countProInterest(),
  ])

  return (
    <div className={PAGE}>
      <PageHeader
        icon={<Sparkles size={18} />}
        title={t('admin.proInterest', lang)}
        subtitle={t('admin.proInterestHint', lang).replace('{n}', String(people))}
      />
      {rows.length === 0 ? (
        <EmptyState title={t('admin.proInterestEmpty', lang)} />
      ) : (
        <div className="flex flex-col gap-2">
          {rows.map((r) => (
            <div key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-border bg-surface px-3.5 py-2.5">
              <span className="min-w-0 flex-1 truncate font-medium text-ink">{r.email}</span>
              {r.source && <span className="rounded-md bg-surface-2 px-1.5 text-caption text-ink-2">{r.source}</span>}
              <span className="text-body-sm text-muted">{new Date(r.createdAt).toLocaleDateString(lang === 'ru' ? 'ru-RU' : 'en-GB')}</span>
              {r.note && <span className="w-full text-body-sm text-ink-2">{r.note}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
