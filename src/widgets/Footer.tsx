import Link from 'next/link'
import { t, type Lang } from '@/shared/i18n'
import { docsUrl, legalUrl } from '@/shared/docs'
import { getMonetizationSettings } from '@/shared/settings/monetization'
import { APP_VERSION } from '@/shared/app-version'
// «О проекте» — отдельный маркетинг-лендинг (проект setfork-about). Живёт по ПУТИ
// /about основного домена (basePath, не поддомен — лучше для SEO). Домен задаётся
// env-переменной; дефолт — setfork.ru/about (куплен под РФ, ADR-0008).
const ABOUT_URL = process.env.NEXT_PUBLIC_ABOUT_URL ?? 'https://setfork.ru/about'

/** Плоский подвал (как в GitHub): один ряд приглушённых ссылок, без границ и колонок. */
export async function Footer({ lang }: { lang: Lang }) {
  const year = new Date().getFullYear()
  const link = 'text-muted hover:text-ink-2 transition-colors'
  // Donate-ссылка задаётся в админке (Монетизация); пусто — пункта нет.
  const { donateUrl } = await getMonetizationSettings()

  return (
    <footer className="mt-auto print:hidden">
      <div className="mx-auto flex w-full max-w-[1080px] flex-wrap items-center justify-center gap-x-4 gap-y-2 px-6 py-8 text-[12px]">
        <span className="text-muted">© {year} SetFork</span>
        <Link href="/explore" className={link}>{t('explore', lang)}</Link>
        {/* Версия приложения (semver из package.json) — как у взрослого приложения. */}
        <span className="font-mono text-muted" title={t('appVersion', lang)}>v{APP_VERSION}</span>
        <a href={ABOUT_URL} className={link}>{t('aboutProject', lang)}</a>
        {/* Репозиторий приватный — публичная ссылка отдаёт 404, поэтому ведём в доки. */}
        <a href={docsUrl('/docs', lang)} target="_blank" rel="noreferrer" className={link}>{t('sourceCode', lang)}</a>
        {/* Contact ведёт на свою форму фидбека (ссылка на issues приватного репо отдавала 404). */}
        <Link href="/feedback" className={link}>{t('feedback', lang)}</Link>
        <a href={legalUrl('terms', lang)} className={link}>{t('terms', lang)}</a>
        <a href={legalUrl('privacy', lang)} className={link}>{t('privacy', lang)}</a>
        {donateUrl && (
          <a href={donateUrl} target="_blank" rel="noreferrer" className={link}>
            {t('footerSupport', lang)}
          </a>
        )}
      </div>
    </footer>
  )
}
