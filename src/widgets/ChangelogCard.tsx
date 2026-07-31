import Link from 'next/link'
import type { Lang } from '@/shared/i18n'
import { t } from '@/shared/i18n'
import { entryText, getChangelog } from '@/features/changelog/service'
import { getChangelogSettings } from '@/shared/settings/changelog'

// Форматтеры дорогие в создании и не зависят от данных — держим по одному на язык.
const FMT: Record<string, Intl.DateTimeFormat> = {
  ru: new Intl.DateTimeFormat('ru', { month: 'short', day: 'numeric' }),
  en: new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric' }),
}

/**
 * Сайдбар-блок «Свежее из changelog» (как у GitHub). Полный список — /changelog.
 *
 * Записи КЛИКАБЕЛЬНЫ, когда у них есть источник: у GitHub каждая строка ведёт в
 * релиз или PR, и без этого changelog — просто список фраз, по которым нельзя
 * посмотреть, что именно изменилось.
 */
export async function ChangelogCard({ lang, limit = 4 }: { lang: Lang; limit?: number }) {
  const s = await getChangelogSettings()
  // Выключено в админке — блока нет вовсе (не пустая карточка).
  if (!s.enabled) return null
  const entries = await getChangelog(limit)
  if (entries.length === 0) return null
  const fmt = FMT[lang === 'ru' ? 'ru' : 'en']

  return (
    <div className="rounded-lg border border-border bg-surface p-3.5">
      <div className="mb-2 text-[12.5px] font-semibold text-ink">{t('changelogLatest', lang)}</div>
      <div className="relative flex flex-col gap-3 pl-3 before:absolute before:bottom-1 before:left-[3px] before:top-1 before:w-px before:bg-border">
        {entries.map((e) => {
          const text = entryText(e, lang)
          return (
            <div key={`${e.at.toISOString()}${text}`} className="relative">
              <span className="absolute left-[-12.5px] top-[5px] h-[7px] w-[7px] rounded-full border border-border bg-surface-2" />
              <div className="text-[11px] text-muted">{fmt.format(e.at)}</div>
              {e.href ? (
                <a
                  href={e.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block text-[12.5px] leading-snug text-ink-2 hover:text-accent"
                >
                  {text}
                </a>
              ) : (
                <div className="text-[12.5px] leading-snug text-ink-2">{text}</div>
              )}
            </div>
          )
        })}
      </div>
      <Link href="/changelog" className="mt-2.5 block text-[12.5px] text-accent hover:underline">
        {t('changelogAll', lang)}
      </Link>
    </div>
  )
}
