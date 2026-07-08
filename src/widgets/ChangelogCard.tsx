import Link from 'next/link'
import type { Lang } from '@/shared/i18n'
import { CHANGELOG } from './changelog-data'

/** Сайдбар-блок «Свежее из changelog» (как у GitHub). Полный список — /changelog. */
export function ChangelogCard({ lang, limit = 4 }: { lang: Lang; limit?: number }) {
  const ru = lang === 'ru'
  const fmt = new Intl.DateTimeFormat(ru ? 'ru' : 'en', { month: 'short', day: 'numeric' })
  return (
    <div className="rounded-lg border border-border bg-surface p-3.5">
      <div className="mb-2 text-[12.5px] font-semibold text-ink">
        {ru ? 'Свежее из changelog' : 'Latest from our changelog'}
      </div>
      <div className="relative flex flex-col gap-3 pl-3 before:absolute before:bottom-1 before:left-[3px] before:top-1 before:w-px before:bg-border">
        {CHANGELOG.slice(0, limit).map((e) => (
          <div key={e.date + e.en} className="relative">
            <span className="absolute left-[-12.5px] top-[5px] h-[7px] w-[7px] rounded-full border border-border bg-surface-2" />
            <div className="font-mono text-[10.5px] text-muted">{fmt.format(new Date(e.date))}</div>
            <div className="text-[12.5px] leading-snug text-ink-2">{ru ? e.ru : e.en}</div>
          </div>
        ))}
      </div>
      <Link href="/changelog" className="mt-2.5 block text-[12px] text-accent hover:underline">
        {ru ? 'Весь changelog →' : 'View changelog →'}
      </Link>
    </div>
  )
}
