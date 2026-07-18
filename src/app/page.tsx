import Link from 'next/link'
import { getSession } from '@/shared/auth/session'
import { getLang } from '@/shared/i18n/server'
import { t } from '@/shared/i18n'
import { HeroSearch } from '@/features/library/HeroSearch'
import { sampleListTitles } from '@/features/library/sample-titles'
import { Dashboard } from '@/widgets/Dashboard'

// Запасные подсказки — только если публичных списков ещё нет (пустая база/стенд).
const FALLBACK_CHIPS = [
  { en: 'Deploy Next.js to a VPS', ru: 'Задеплоить Next.js на VPS' },
  { en: 'Respond to a Sev-1 incident', ru: 'Отработать Sev-1 инцидент' },
  { en: 'Set up a new Mac for dev', ru: 'Настроить новый Mac для разработки' },
  { en: 'Upgrade Postgres safely', ru: 'Безопасно обновить Postgres' },
]
// Плейсхолдер поиска — тоже не одна надпись: крутим пул фраз (+ вариант с
// примером из живого списка, он собирается ниже).
const PLACEHOLDERS = [
  { en: 'Describe what you need to do…', ru: 'Опиши, что нужно сделать…' },
  { en: 'What are we setting up today?', ru: 'Что настраиваем сегодня?' },
  { en: 'Find a proven list…', ru: 'Найди проверенный список…' },
  { en: 'What needs doing — step by step?', ru: 'Что нужно сделать — по шагам?' },
  { en: 'Ask for a list on any topic…', ru: 'Спроси список на любую тему…' },
]
const CHIPS_SHOWN = 4 // сколько показываем за раз

const pick = <T,>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)]

export default async function HomePage() {
  const [lang, session] = await Promise.all([getLang(), getSession()])
  if (session) return <Dashboard lang={lang} userId={session.userId} />

  const ru = lang === 'ru'
  const titles = await sampleListTitles(lang)
  const chips = titles.length >= CHIPS_SHOWN ? titles.slice(0, CHIPS_SHOWN) : FALLBACK_CHIPS.map((c) => (ru ? c.ru : c.en))
  // Пул фраз + «Например: «живой заголовок»» (берём тот, что не попал в чипы).
  const example = titles[CHIPS_SHOWN]
  const placeholder = pick([
    ...PLACEHOLDERS.map((p) => (ru ? p.ru : p.en)),
    ...(example ? [ru ? `Например: «${example}»` : `e.g. “${example}”`] : []),
  ])

  return (
    <div className="flex flex-1 items-center justify-center px-4 py-16">
      <div className="flex w-full max-w-[640px] flex-col items-center gap-6 text-center">
        <div className="font-logo text-[44px] leading-none tracking-tight text-ink sm:text-[64px]">SetFork</div>

        <HeroSearch placeholder={placeholder} clearLabel={t('clear', lang)} />

        <div className="flex max-w-[640px] flex-wrap justify-center gap-2.5">
          {chips.map((c) => (
            <Link
              key={c}
              href={`/search?q=${encodeURIComponent(c)}`}
              className="rounded-full border border-border bg-surface-2 px-3.5 py-[7px] text-[13px] text-ink-2 hover:text-ink"
            >
              {c}
            </Link>
          ))}
        </div>
      </div>
    </div>
  )
}
