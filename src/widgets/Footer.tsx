import Link from 'next/link'
import { t, type Lang } from '@/shared/i18n'

const REPO_URL = 'https://github.com/mikey-semy/setfork-frontend'

/** Глобальный подвал (GitHub-подобный): бренд + группы ссылок + нижняя полоса. */
export function Footer({ lang }: { lang: Lang }) {
  const year = new Date().getFullYear()

  const group = (title: string, links: { href: string; label: string; external?: boolean }[]) => (
    <div className="flex flex-col gap-2">
      <div className="text-[11px] font-semibold uppercase tracking-wider text-muted">{title}</div>
      {links.map((l) =>
        l.external ? (
          <a key={l.href} href={l.href} target="_blank" rel="noreferrer" className="text-[12.5px] text-ink-2 hover:text-ink">
            {l.label}
          </a>
        ) : (
          <Link key={l.href} href={l.href} className="text-[12.5px] text-ink-2 hover:text-ink">
            {l.label}
          </Link>
        ),
      )}
    </div>
  )

  return (
    <footer className="mt-auto border-t border-border bg-surface print:hidden">
      <div className="mx-auto grid w-full max-w-[1080px] grid-cols-2 gap-8 px-6 py-10 sm:grid-cols-[1.4fr_1fr_1fr_1fr]">
        {/* бренд */}
        <div className="col-span-2 flex flex-col gap-2 sm:col-span-1">
          <Link href="/" aria-label="SetFork" className="font-logo text-[18px] leading-none text-ink">
            SF
          </Link>
          <p className="max-w-[240px] text-[12.5px] leading-snug text-ink-2">{t('footerTagline', lang)}</p>
        </div>

        {group(t('footerProduct', lang), [
          { href: '/explore', label: t('explore', lang) },
          { href: '/new', label: t('newList', lang) },
          { href: '/my-lists', label: t('myLists', lang) },
        ])}

        {group(t('footerResources', lang), [
          { href: '/about', label: t('aboutProject', lang) },
          { href: REPO_URL, label: t('sourceCode', lang), external: true },
          { href: `${REPO_URL}/issues`, label: t('contact', lang), external: true },
        ])}

        {group(t('footerLegal', lang), [
          { href: '/terms', label: t('terms', lang) },
          { href: '/privacy', label: t('privacy', lang) },
        ])}
      </div>

      <div className="border-t border-border">
        <div className="mx-auto flex w-full max-w-[1080px] flex-wrap items-center justify-between gap-2 px-6 py-4 text-[11.5px] text-muted">
          <span>
            © {year} SetFork. {t('allRightsReserved', lang)}
          </span>
          <a href={REPO_URL} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 hover:text-ink-2">
            <GithubMark /> mikey-semy/setfork
          </a>
        </div>
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
