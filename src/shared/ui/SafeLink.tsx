import type { AnchorHTMLAttributes, ReactNode } from 'react'
import { safeHref } from '@/shared/lib/safe-url'

// ЕДИНЫЙ способ отрендерить ПОЛЬЗОВАТЕЛЬСКИЙ URL ссылкой. href всегда прогоняется через
// safeHref (javascript:/data:/vbscript: → мёртвая ссылка), внешние по умолчанию открываются
// в новой вкладке с rel="noreferrer". Чтобы XSS-инвариант не держался на памяти разработчика
// (сырой <a href={userVar}> легко забыть санитизировать) — пользовательские URL идут ТОЛЬКО
// через этот компонент. Небезопасный/пустой href → не ссылка, а <span> (текст виден, клика нет).
type SafeLinkProps = { href: string | null | undefined; children?: ReactNode } & Omit<
  AnchorHTMLAttributes<HTMLAnchorElement>,
  'href'
>

export function SafeLink({ href, children, target, rel, ...rest }: SafeLinkProps) {
  const safe = safeHref(href)
  if (!safe) return <span {...rest}>{children}</span>
  return (
    <a href={safe} target={target ?? '_blank'} rel={rel ?? 'noreferrer'} {...rest}>
      {children}
    </a>
  )
}
