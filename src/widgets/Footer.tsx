import Link from 'next/link'
import { t, type Lang } from '@/shared/i18n'

// Репозиторий приватный — публичная ссылка на него отдаёт 404. Ведём в доки;
// когда репо откроется, вернуть REPO_URL на github.
const REPO_URL = 'https://docs.setfork.com'
// Юридические страницы живут в доках; роуты /terms и /privacy редиректят туда же.
const LEGAL_URL = `${REPO_URL}/docs/legal`

/** Плоский подвал (как в GitHub): один ряд приглушённых ссылок, без границ и колонок. */
export function Footer({ lang }: { lang: Lang }) {
  const year = new Date().getFullYear()
  const link = 'text-muted hover:text-ink-2 transition-colors'

  return (
    <footer className="mt-auto print:hidden">
      <div className="mx-auto flex w-full max-w-[1080px] flex-wrap items-center justify-center gap-x-4 gap-y-2 px-6 py-8 text-[12px]">
        <span className="text-muted">© {year} SetFork</span>
        <Link href="/explore" className={link}>{t('explore', lang)}</Link>
        <Link href="/about" className={link}>{t('aboutProject', lang)}</Link>
        <a href={REPO_URL} target="_blank" rel="noreferrer" className={link}>{t('sourceCode', lang)}</a>
        <a href={`${REPO_URL}/issues`} target="_blank" rel="noreferrer" className={link}>{t('contact', lang)}</a>
        <a href={`${LEGAL_URL}/terms`} className={link}>{t('terms', lang)}</a>
        <a href={`${LEGAL_URL}/privacy`} className={link}>{t('privacy', lang)}</a>
      </div>
    </footer>
  )
}
