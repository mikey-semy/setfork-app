import Link from 'next/link'
import { t, type Lang } from '@/shared/i18n'
import { aboutUrl, legalUrl } from '@/shared/docs'
import { getMonetizationSettings } from '@/shared/settings/monetization'
import { APP_VERSION } from '@/shared/app-version'
import { PAGE_X } from '@/shared/ui/control'

/** Плоский подвал (как в GitHub): один ряд приглушённых ссылок, без границ и колонок. */
export async function Footer({ lang }: { lang: Lang }) {
  const year = new Date().getFullYear()
  const link = 'text-muted hover:text-ink-2 transition-colors'
  // Donate-ссылка задаётся в админке (Монетизация); пусто — пункта нет.
  const { donateUrl } = await getMonetizationSettings()

  return (
    <footer className="relative mt-auto print:hidden">
      {/* Копирайт — отдельной строкой ПОД ссылками и по центру (как у GitHub): в общем
          ряду он читался как ещё один пункт меню. */}
      <div className={`${PAGE_X} flex flex-wrap items-center justify-center gap-x-4 gap-y-1 pt-6 text-body-sm`}>
        <Link href="/explore" className={link}>{t('explore', lang)}</Link>
        <a href={aboutUrl()} className={link}>{t('aboutProject', lang)}</a>
        {/* «Исходный код» убран из футера (владелец): репо приватный, ссылка вела в доки,
            а не в исходники — вводила в заблуждение. Доки доступны из других мест. */}
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
      <div className="px-6 pb-4 pt-1.5 text-center text-body-sm text-muted">© {year} SetFork</div>
      {/* Версия — незаметно в углу (мелкий прозрачный моно), а не в ряду ссылок. */}
      {/* Нативной подсказки тут не было НИКОГДА: у элемента `pointer-events-none`,
          то есть наведения он не получает и title показать не может. Убрана как
          мёртвая, а не заменена — версия и так подписана в самой строке. */}
      <span className="pointer-events-none absolute bottom-1.5 right-2.5 font-mono text-caption text-muted opacity-50 select-none">
        v{APP_VERSION}
      </span>
    </footer>
  )
}
