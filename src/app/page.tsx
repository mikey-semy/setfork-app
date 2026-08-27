import Link from 'next/link'
import { getSession } from '@/shared/auth/session'
import { getLang } from '@/shared/i18n/server'
import { t } from '@/shared/i18n'
import { buttonClass } from '@/shared/ui/button-style'
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

// Главная — полный title (absolute): template «%s · SetFork» дал бы «SetFork — … · SetFork».
// Слоган — из словаря, на языке пользователя; en повторяет корневой default в layout.
export async function generateMetadata() {
  const lang = await getLang()
  return { title: { absolute: `SetFork — ${t('homeTagline', lang)}` } }
}

export default async function HomePage() {
  const [lang, session] = await Promise.all([getLang(), getSession()])
  if (session) return <Dashboard lang={lang} userId={session.userId} />

  const ru = lang === 'ru'
  const titles = await sampleListTitles(lang)
  const chips = titles.length >= CHIPS_SHOWN ? titles.slice(0, CHIPS_SHOWN) : FALLBACK_CHIPS.map((c) => (ru ? c.ru : c.en))
  // Пул фраз + живой заголовок КАК ЕСТЬ. Без приписки «Например:» — плейсхолдер и так
  // читается как пример, а приписка только удлиняла строку.
  const example = titles[CHIPS_SHOWN]
  const placeholder = pick([...PLACEHOLDERS.map((p) => (ru ? p.ru : p.en)), ...(example ? [example] : [])])

  return (
    <div className="flex flex-1 items-center justify-center px-4 py-16">
      <div className="flex w-full max-w-prose flex-col items-center gap-6 text-center">
        {/* Логотип И ЕСТЬ заголовок страницы: отдельного h1 у лендинга не было, а
            диктору нужен один. Кегль и начертание не меняются — меняется только тег. */}
        <h1 className="font-logo text-logo-lg leading-none tracking-tight text-ink sm:text-logo-xl">SetFork</h1>

        <HeroSearch placeholder={placeholder} clearLabel={t('clear', lang)} />

        <div className="flex max-w-prose flex-wrap justify-center gap-2.5">
          {chips.map((c) => (
            <Link
              key={c}
              href={`/search?q=${encodeURIComponent(c)}`}
              className={buttonClass({ variant: 'outline', className: 'rounded-full' })}
            >
              {c}
            </Link>
          ))}
        </div>
      </div>
    </div>
  )
}
