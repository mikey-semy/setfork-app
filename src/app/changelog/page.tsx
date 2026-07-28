import Link from 'next/link'
import type { Metadata } from 'next'
import { ArrowLeft } from 'lucide-react'
import { notFound } from 'next/navigation'
import { getLang } from '@/shared/i18n/server'
import { getChangelogSettings } from '@/shared/settings/changelog'
import { t } from '@/shared/i18n'
import { FloatingBack } from '@/shared/ui/FloatingBack'
import { EmptyState } from '@/shared/ui/EmptyState'
import { entryText, getChangelog } from '@/features/changelog/service'

export const metadata: Metadata = { title: 'Changelog' }

/**
 * Публичный changelog продукта (полный список; сайдбар-карточка — ChangelogCard).
 *
 * Возврат — по той же схеме, что у создания правки: ссылка сверху плюс плавающий
 * дубль. На длинном списке верхняя уезжает за экран, и раньше выйти отсюда можно
 * было только через шапку или футер.
 */
export default async function ChangelogPage() {
  // Тумблер выключает и СТРАНИЦУ, а не только карточку: иначе «выключено» в
  // админке оставляло публичный адрес доступным, да ещё с сидовой историей.
  // Независимые запросы — параллельно (react-doctor).
  const [lang, settings, entries] = await Promise.all([getLang(), getChangelogSettings(), getChangelog(200)])
  if (!settings.enabled) notFound()
  const fmt = new Intl.DateTimeFormat(lang === 'ru' ? 'ru' : 'en', { year: 'numeric', month: 'long', day: 'numeric' })

  return (
    <div className="mx-auto w-full max-w-[720px] px-4 py-8 sm:px-6 sm:py-10">
      <Link href="/" className="mb-4 inline-flex items-center gap-2 text-[13px] text-ink-2 hover:text-ink">
        <ArrowLeft size={15} /> {t('home', lang)}
      </Link>
      <FloatingBack href="/" label={t('home', lang)} />

      <h1 className="mb-1 text-[22px] font-bold text-ink">Changelog</h1>
      <p className="mb-8 text-[13.5px] text-ink-2">{t('changelogSub', lang)}</p>

      {entries.length === 0 ? (
        <EmptyState title={t('changelogNone', lang)} />
      ) : (
        <div className="relative flex flex-col gap-7 pl-5 before:absolute before:bottom-2 before:left-[5px] before:top-2 before:w-px before:bg-border">
          {entries.map((e) => {
            const text = entryText(e, lang)
            return (
              <div key={`${e.at.toISOString()}${text}`} className="relative">
                <span className="absolute left-[-19px] top-[6px] h-[9px] w-[9px] rounded-full border border-border-strong bg-surface-2" />
                <div className="font-mono text-[11.5px] text-muted">{fmt.format(e.at)}</div>
                {/* Запись ведёт в свой источник (PR или релиз) — иначе changelog
                    это список фраз, по которым не посмотреть, что изменилось. */}
                {e.href ? (
                  <a
                    href={e.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-0.5 block text-[14.5px] leading-relaxed text-ink hover:text-accent"
                  >
                    {text}
                  </a>
                ) : (
                  <div className="mt-0.5 text-[14.5px] leading-relaxed text-ink">{text}</div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
