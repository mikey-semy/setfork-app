import Link from 'next/link'
import { sql } from 'drizzle-orm'
import { db, templates } from '@/shared/db'
import { getSession } from '@/shared/auth/session'
import { getLang } from '@/shared/i18n/server'
import { t } from '@/shared/i18n'
import { HeroSearch } from '@/features/library/HeroSearch'
import { Dashboard } from '@/widgets/Dashboard'

const CHIPS = [
  { en: 'Deploy Next.js to a VPS', ru: 'Задеплоить Next.js на VPS' },
  { en: 'Respond to a Sev-1 incident', ru: 'Отработать Sev-1 инцидент' },
  { en: 'Set up a new Mac for dev', ru: 'Настроить новый Mac для разработки' },
  { en: 'Upgrade Postgres safely', ru: 'Безопасно обновить Postgres' },
]

async function stats() {
  const [[tpl], [likes]] = await Promise.all([
    db.select({ c: sql<number>`count(*)::int` }).from(templates),
    db.select({ c: sql<number>`coalesce(sum(${templates.starsCount}), 0)::int` }).from(templates),
  ])
  return { templates: tpl?.c ?? 0, likes: likes?.c ?? 0 }
}

export default async function HomePage() {
  const [lang, session] = await Promise.all([getLang(), getSession()])
  if (session) return <Dashboard lang={lang} userId={session.userId} />

  const s = await stats()
  const ru = lang === 'ru'

  return (
    <div className="flex flex-1 items-center justify-center px-4 py-16">
        <div className="flex w-full max-w-[640px] flex-col items-center gap-6 text-center">
          <div className="text-[64px] font-bold leading-none tracking-tight text-ink">SF</div>
          <div className="-mt-2 text-[15px] text-ink-2">{t('heroSub', lang)}</div>

          <HeroSearch placeholder={t('searchPh', lang)} clearLabel={t('clear', lang)} />

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
              ? 'Эталонные списки, выверенные сообществом: лучший всплывает по лайкам, а форкнуть и улучшить может каждый. Единый источник правды по теме.'
              : 'Canonical lists, refined by the community: the best rises by likes, and anyone can fork it and make it better. One source of truth per topic.'}
          </div>

          <div className="font-mono text-[12px] text-muted">
            {ru
              ? `${s.templates} списков · ${s.likes.toLocaleString('ru')} лайков`
              : `${s.templates} lists · ${s.likes.toLocaleString('en')} likes`}
          </div>
        </div>
    </div>
  )
}
