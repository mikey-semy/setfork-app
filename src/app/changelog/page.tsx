import type { Metadata } from 'next'
import { getLang } from '@/shared/i18n/server'
import { CHANGELOG } from '@/widgets/changelog-data'

export const metadata: Metadata = { title: 'Changelog · SetFork' }

/** Публичный changelog продукта (полный список; сайдбар-карточка — ChangelogCard). */
export default async function ChangelogPage() {
  const lang = await getLang()
  const ru = lang === 'ru'
  const fmt = new Intl.DateTimeFormat(ru ? 'ru' : 'en', { year: 'numeric', month: 'long', day: 'numeric' })
  return (
    <div className="mx-auto w-full max-w-[720px] px-6 py-10">
      <h1 className="mb-1 text-[22px] font-bold text-ink">Changelog</h1>
      <p className="mb-8 text-[13.5px] text-ink-2">
        {ru ? 'Что нового в SetFork — заметные фичи и улучшения.' : 'What’s new in SetFork — notable features and improvements.'}
      </p>
      <div className="relative flex flex-col gap-7 pl-5 before:absolute before:bottom-2 before:left-[5px] before:top-2 before:w-px before:bg-border">
        {CHANGELOG.map((e) => (
          <div key={e.date + e.en} className="relative">
            <span className="absolute -left-[19px] top-[6px] h-[9px] w-[9px] rounded-full border border-border-strong bg-surface-2" />
            <div className="font-mono text-[11.5px] text-muted">{fmt.format(new Date(e.date))}</div>
            <div className="mt-0.5 text-[14.5px] leading-relaxed text-ink">{ru ? e.ru : e.en}</div>
          </div>
        ))}
      </div>
    </div>
  )
}
