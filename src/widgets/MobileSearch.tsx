'use client'

import { useState } from 'react'
import { createPortal } from 'react-dom'
import { useRouter } from 'next/navigation'
import { ListChecks, Search, X } from 'lucide-react'
import type { Lang } from '@/shared/i18n'
import { IconButton } from '@/shared/ui/IconButton'
import { cardClass } from '@/shared/ui/card-style'
import { buttonClass } from '@/shared/ui/button-style'

/** Мобильный поиск: оверлей НА МЕСТЕ (не редирект на /search — оттуда не вернуться).
 *  На странице списка первая опция — «искать в этом списке» (?find= фильтрует шаги,
 *  как поиск по файлам в GitHub-репо); Enter/вторая опция — глобальный поиск. */
export function MobileSearch({
  crumb,
  lang,
  className,
}: {
  crumb: { handle: string; slug?: string } | null
  lang: Lang
  className?: string
}) {
  const ru = lang === 'ru'
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')

  const inList = crumb?.slug ? `/${crumb.handle}/${crumb.slug}` : null
  const go = (href: string) => {
    setOpen(false)
    setQ('')
    router.push(href)
  }

  return (
    <>
      <IconButton variant="ghost" label={ru ? 'Поиск' : 'Search'} onClick={() => setOpen(true)} className={className}>
        <Search size={17} />
      </IconButton>
      {open &&
        createPortal(
          <div className="fixed inset-0 z-50 bg-black/40 p-3 pt-14" onClick={() => setOpen(false)}>
            <div onClick={(e) => e.stopPropagation()} className={cardClass({ pad: 'sm', className: 'mx-auto max-w-hero shadow-card' })}>
              <div className="flex items-center gap-2">
                <Search size={15} className="shrink-0 text-muted" />
                <input
                  autoFocus
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && q.trim()) go(`/search?q=${encodeURIComponent(q.trim())}`)
                    if (e.key === 'Escape') setOpen(false)
                  }}
                  placeholder={ru ? 'Поиск…' : 'Search…'}
                  className="min-w-0 flex-1 bg-transparent py-1.5 text-title text-ink outline-hidden placeholder:text-muted"
                />
                <button type="button" aria-label="close" onClick={() => setOpen(false)} className={buttonClass({ variant: 'ghost' })}>
                  <X size={16} />
                </button>
              </div>
              <div className="mt-1 border-t border-border pt-1">
                {inList && (
                  <button
                    type="button"
                    disabled={!q.trim()}
                    onClick={() => go(`${inList}?find=${encodeURIComponent(q.trim())}`)}
                    className={buttonClass({ variant: 'ghost', className: 'w-full text-left hover:bg-surface-2 disabled:opacity-45' })}
                  >
                    <ListChecks size={14} className="shrink-0 text-muted" />
                    <span className="min-w-0 truncate">
                      {ru ? 'Искать в' : 'Search in'} <b>{crumb!.handle}/{crumb!.slug}</b>
                    </span>
                  </button>
                )}
                <button
                  type="button"
                  disabled={!q.trim()}
                  onClick={() => go(`/search?q=${encodeURIComponent(q.trim())}`)}
                  className={buttonClass({ variant: 'ghost', className: 'w-full text-left hover:bg-surface-2 disabled:opacity-45' })}
                >
                  <Search size={14} className="shrink-0 text-muted" />
                  {ru ? 'Искать везде' : 'Search everywhere'} <kbd className="ml-auto rounded-md border border-border px-1 text-caption text-muted">↵</kbd>
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  )
}
