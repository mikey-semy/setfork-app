import Link from 'next/link'
import { t, type Lang } from '@/shared/i18n'

const REPO_URL = 'https://github.com/mikey-semy/setfork-frontend'

/** Плоский подвал (как в GitHub): один ряд приглушённых ссылок, без границ и колонок. */
export function Footer({ lang }: { lang: Lang }) {
  const year = new Date().getFullYear()
  const link = 'text-muted hover:text-ink-2 transition-colors'

  return (
    <footer className="mt-auto print:hidden">
      <div className="mx-auto flex w-full max-w-[1080px] flex-wrap items-center justify-center gap-x-4 gap-y-2 px-6 py-8 text-[12px]">
        <a href={REPO_URL} target="_blank" rel="noreferrer" className={`inline-flex items-center gap-1.5 ${link}`}>
          <GithubMark /> © {year} SetFork
        </a>
        <Link href="/explore" className={link}>{t('explore', lang)}</Link>
        <Link href="/about" className={link}>{t('aboutProject', lang)}</Link>
        <a href={REPO_URL} target="_blank" rel="noreferrer" className={link}>{t('sourceCode', lang)}</a>
        <a href={`${REPO_URL}/issues`} target="_blank" rel="noreferrer" className={link}>{t('contact', lang)}</a>
        <Link href="/terms" className={link}>{t('terms', lang)}</Link>
        <Link href="/privacy" className={link}>{t('privacy', lang)}</Link>
      </div>
    </footer>
  )
}

function GithubMark() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M12 2C6.48 2 2 6.58 2 12.25c0 4.53 2.87 8.37 6.84 9.73.5.1.68-.22.68-.49 0-.24-.01-.87-.01-1.71-2.78.62-3.37-1.37-3.37-1.37-.46-1.18-1.11-1.49-1.11-1.49-.9-.63.07-.62.07-.62 1 .07 1.53 1.05 1.53 1.05.89 1.56 2.34 1.11 2.91.85.09-.66.35-1.11.63-1.37-2.22-.26-4.56-1.14-4.56-5.07 0-1.12.39-2.03 1.03-2.75-.1-.26-.45-1.3.1-2.7 0 0 .84-.28 2.75 1.05a9.35 9.35 0 0 1 5 0c1.91-1.33 2.75-1.05 2.75-1.05.55 1.4.2 2.44.1 2.7.64.72 1.03 1.63 1.03 2.75 0 3.94-2.34 4.81-4.57 5.06.36.32.68.94.68 1.9 0 1.37-.01 2.48-.01 2.82 0 .27.18.6.69.49A10.02 10.02 0 0 0 22 12.25C22 6.58 17.52 2 12 2z" />
    </svg>
  )
}
