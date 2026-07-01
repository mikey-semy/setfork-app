import Link from 'next/link'
import { Plus, Search } from 'lucide-react'
import { LangSwitch, ThemeToggle } from '@/shared/ui/controls'
import { t, type Lang } from '@/shared/i18n'
import type { SessionUser } from '@/shared/auth/session'

function Avatar({ user }: { user: SessionUser }) {
  if (user.avatarUrl) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={user.avatarUrl} alt={user.handle} className="h-[30px] w-[30px] rounded-full object-cover" />
  }
  return (
    <div className="grid h-[30px] w-[30px] place-items-center rounded-full bg-ink text-xs font-bold text-[var(--canvas)]">
      {(user.name ?? user.handle).charAt(0).toUpperCase()}
    </div>
  )
}

export function TopNav({ lang, user, active }: { lang: Lang; user: SessionUser | null; active?: 'explore' | 'runs' | 'mylists' }) {
  const link = (href: string, label: string, key: string) => (
    <Link href={href} className={active === key ? 'text-ink' : 'text-ink-2 hover:text-ink'}>
      {label}
    </Link>
  )
  return (
    <div className="flex items-center gap-4 border-b border-border bg-surface px-5 py-3">
      <Link href="/" className="flex-shrink-0 text-[17px] font-bold tracking-tight text-ink">
        SH
      </Link>
      <Link
        href="/explore"
        className="flex max-w-[420px] flex-1 items-center gap-2 rounded-md border border-border bg-surface-2 px-3 py-[7px] text-muted"
      >
        <Search size={15} />
        <span className="truncate text-[13px]">{t('searchLists', lang)}</span>
      </Link>
      <div className="ml-1 hidden items-center gap-[22px] text-[13.5px] font-medium sm:flex">
        {link('/explore', t('explore', lang), 'explore')}
        {link('/my-lists', t('myLists', lang), 'mylists')}
        {link('/runs', t('runs', lang), 'runs')}
      </div>
      <div className="ml-auto flex items-center gap-3">
        <Link
          href="/new"
          className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-[13px] font-semibold text-primary-fg"
        >
          <Plus size={14} />
          <span className="hidden sm:inline">{t('newList', lang)}</span>
        </Link>
        <LangSwitch lang={lang} />
        <ThemeToggle />
        {user ? (
          <Link href="/runs">
            <Avatar user={user} />
          </Link>
        ) : (
          <Link href="/login" className="text-[13px] font-semibold text-ink">
            {t('signIn', lang)}
          </Link>
        )}
      </div>
    </div>
  )
}
