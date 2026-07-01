import Link from 'next/link'
import { ArrowRight, Search } from 'lucide-react'
import { sql } from 'drizzle-orm'
import { db, runs, templates } from '@/shared/db'
import { getLang } from '@/shared/i18n/server'
import { t } from '@/shared/i18n'

const CHIPS = [
  { en: 'Deploy Next.js to a VPS', ru: 'Задеплоить Next.js на VPS' },
  { en: 'Respond to a Sev-1 incident', ru: 'Отработать Sev-1 инцидент' },
  { en: 'Set up a new Mac for dev', ru: 'Настроить новый Mac для разработки' },
  { en: 'Upgrade Postgres safely', ru: 'Безопасно обновить Postgres' },
]

async function stats() {
  const [[tpl], [run]] = await Promise.all([
    db.select({ c: sql<number>`count(*)::int` }).from(templates),
    db.select({ c: sql<number>`count(*)::int` }).from(runs),
  ])
  return { templates: tpl?.c ?? 0, runs: run?.c ?? 0 }
}

export default async function HomePage() {
  const [lang, s] = await Promise.all([getLang(), stats()])
  const ru = lang === 'ru'

  return (
    <div className="flex flex-1 items-center justify-center px-4 py-16">
        <div className="flex w-full max-w-[640px] flex-col items-center gap-6 text-center">
          <div className="text-[64px] font-bold leading-none tracking-tight text-ink">SH</div>
          <div className="-mt-2 text-[15px] text-ink-2">{t('heroSub', lang)}</div>

          <form
            action="/explore"
            className="flex w-full max-w-[600px] items-center gap-3 rounded-[14px] border border-border bg-surface px-4 py-3.5 shadow-[0_12px_36px_-14px_rgba(0,0,0,.22)]"
          >
            <Search size={18} className="text-muted" />
            <input
              name="q"
              placeholder={t('searchPh', lang)}
              className="flex-1 border-0 bg-transparent text-[15px] text-ink outline-none"
            />
            <button
              type="submit"
              className="grid h-[34px] w-[34px] place-items-center rounded-md bg-primary text-primary-fg"
              aria-label="Search"
            >
              <ArrowRight size={16} />
            </button>
          </form>

          <div className="flex max-w-[640px] flex-wrap justify-center gap-2.5">
            {CHIPS.map((c, i) => (
              <Link
                key={i}
                href={`/explore?q=${encodeURIComponent(ru ? c.ru : c.en)}`}
                className="rounded-full border border-border bg-surface-2 px-3.5 py-[7px] text-[13px] text-ink-2 hover:text-ink"
              >
                {ru ? c.ru : c.en}
              </Link>
            ))}
          </div>

          <div className="max-w-[600px] text-[13.5px] leading-relaxed text-ink-2">
            {ru
              ? 'Список — не статичный док. Ты прогоняешь его, отмечаешь шаги, он хранит прогресс и версию, а форкнуть готовый можно под свой стек.'
              : "A list isn't a static doc. You run it, tick steps off, it saves progress and the version — and you can fork a proven one to your own stack."}
          </div>

          <div className="font-mono text-[12px] text-muted">
            {ru
              ? `${s.templates} списков · ${s.runs} прогонов`
              : `${s.templates} lists · ${s.runs} runs`}
          </div>
        </div>
    </div>
  )
}
