import { GitFork, Star } from 'lucide-react'
import { t, type Lang } from '@/shared/i18n'

// GitHub-стайл граф активности (contribution-хитмап) за ~год.
const LEVEL = ['bg-border', 'bg-ok/25', 'bg-ok/50', 'bg-ok/75', 'bg-ok']
const level = (c: number): number => (c === 0 ? 0 : c <= 2 ? 1 : c <= 4 ? 2 : c <= 6 ? 3 : 4)
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

export function ActivityGraph({
  contributions,
  starsReceived,
  forksReceived,
  lang,
}: {
  contributions: { date: string; count: number }[]
  starsReceived: number
  forksReceived: number
  lang: Lang
}) {
  const map = new Map(contributions.map((c) => [c.date, c.count]))
  const total = contributions.reduce((s, c) => s + c.count, 0)

  const end = new Date()
  end.setHours(0, 0, 0, 0)
  const start = new Date(end)
  start.setDate(start.getDate() - 364)
  start.setDate(start.getDate() - start.getDay()) // выравниваем на начало недели (вс)

  const weeks: { date: string; count: number; future: boolean }[][] = []
  const cur = new Date(start)
  while (cur <= end) {
    const week: { date: string; count: number; future: boolean }[] = []
    for (let d = 0; d < 7; d++) {
      const ds = iso(cur)
      week.push({ date: ds, count: map.get(ds) ?? 0, future: cur > end })
      cur.setDate(cur.getDate() + 1)
    }
    weeks.push(week)
  }
  const fmtMonth = new Intl.DateTimeFormat(lang === 'ru' ? 'ru' : 'en', { month: 'short' })
  let lastLabel = -3
  const months = weeks.map((w, i) => {
    const m = new Date(w[0].date).getMonth()
    const prev = i > 0 ? new Date(weeks[i - 1][0].date).getMonth() : -1
    // Метку месяца показываем только если она не впритык к предыдущей (иначе накладываются).
    if (m !== prev && i - lastLabel >= 3) {
      lastLabel = i
      return fmtMonth.format(new Date(w[0].date))
    }
    return null
  })

  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-ink-2">
        <span>
          <b className="text-ink">{total}</b> {t('contributions', lang)} {t('inLastYear', lang)}
        </span>
        <span className="inline-flex items-center gap-1">
          <Star size={13} className="text-muted" /> <b className="text-ink">{starsReceived}</b> {t('starsReceived', lang)}
        </span>
        <span className="inline-flex items-center gap-1">
          <GitFork size={13} className="text-muted" /> <b className="text-ink">{forksReceived}</b> {t('forksReceived', lang)}
        </span>
      </div>

      <div className="scroll-thin overflow-x-auto pb-1">
        <div className="inline-flex flex-col gap-1">
          <div className="flex gap-[3px] text-[10px] leading-none text-muted">
            {months.map((m, i) => (
              <div key={i} className="w-[11px] whitespace-nowrap">
                {m ?? ''}
              </div>
            ))}
          </div>
          <div className="flex gap-[3px]">
            {weeks.map((week, wi) => (
              <div key={wi} className="flex flex-col gap-[3px]">
                {week.map((cell, di) =>
                  cell.future ? (
                    <div key={di} className="h-[11px] w-[11px]" />
                  ) : (
                    <div
                      key={di}
                      title={`${cell.count} ${t('contributions', lang)} · ${cell.date}`}
                      className={`h-[11px] w-[11px] rounded-[2px] ${LEVEL[level(cell.count)]}`}
                    />
                  ),
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="mt-2 flex items-center justify-end gap-1 text-[10px] text-muted">
        <span>{t('less', lang)}</span>
        {LEVEL.map((cls, i) => (
          <span key={i} className={`h-[11px] w-[11px] rounded-[2px] ${cls}`} />
        ))}
        <span>{t('more', lang)}</span>
      </div>
    </div>
  )
}
