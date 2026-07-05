import Link from 'next/link'

// Единый таб-бар под шапкой (GitHub-стиль) — ОДИН источник правды для профиля,
// страницы списка и любых будущих разделов. Не плодить локальные копии.

export function TabNav({
  children,
  maxWidthClass = 'max-w-[1180px]',
}: {
  children: React.ReactNode
  maxWidthClass?: string
}) {
  return (
    <div className="border-b border-border">
      <nav className={`no-scrollbar mx-auto flex w-full gap-1 overflow-x-auto px-4 text-[14px] ${maxWidthClass}`}>
        {children}
      </nav>
    </div>
  )
}

export function TabItem({
  href,
  on,
  icon,
  label,
  count,
}: {
  href: string
  on: boolean
  icon: React.ReactNode
  label: string
  count?: number
}) {
  return (
    <Link
      href={href}
      className={`-mb-px inline-flex shrink-0 items-center gap-2 whitespace-nowrap border-b-2 px-3 py-2.5 ${
        on ? 'border-accent font-semibold text-ink' : 'border-transparent font-medium text-ink-2 hover:text-ink'
      }`}
    >
      <span className={on ? 'text-ink' : 'text-muted'}>{icon}</span> {label}
      {count != null && count > 0 && (
        <span className="rounded-full bg-surface-2 px-1.5 text-[11.5px] text-ink-2">{count}</span>
      )}
    </Link>
  )
}
