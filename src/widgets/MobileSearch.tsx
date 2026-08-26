'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { ListChecks, Search, X } from 'lucide-react'
import { t, type Lang } from '@/shared/i18n'
import { IconButton } from '@/shared/ui/IconButton'
import { OverlayPanel } from '@/shared/ui/OverlayPanel'
import { MenuItem } from '@/shared/ui/MenuItem'
import { Input } from '@/shared/ui/input'

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
      {/* Окно поиска — общая модальная панель, а не свой портал: от неё приходит и
          объявление окна диктору (role=dialog, имя из заголовка), и увод фокуса внутрь,
          и возврат фокуса на кнопку при закрытии. Своя копия всего этого не имела. */}
      <OverlayPanel open={open} onClose={() => setOpen(false)} align="top" width={0} bare title={t('searchTitle', lang)} closeLabel={t('close', lang)} className="w-full max-w-hero">
        <div className="p-3">
          <div className="flex items-center gap-2">
            <Search size={15} className="shrink-0 text-muted" />
            <Input autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && q.trim()) go(`/search?q=${encodeURIComponent(q.trim())}`)
              }}
              placeholder={ru ? 'Поиск…' : 'Search…'} className="min-w-0 flex-1" />
          </div>
          <div className="mt-1 border-t border-border pt-1">
            {inList && (
              <MenuItem disabled={!q.trim()} onClick={() => go(`${inList}?find=${encodeURIComponent(q.trim())}`)}>
                <ListChecks size={14} className="shrink-0 text-muted" />
                <span className="min-w-0 truncate">
                  {ru ? 'Искать в' : 'Search in'} <b>{crumb!.handle}/{crumb!.slug}</b>
                </span>
              </MenuItem>
            )}
            <MenuItem disabled={!q.trim()} onClick={() => go(`/search?q=${encodeURIComponent(q.trim())}`)}>
              <Search size={14} className="shrink-0 text-muted" />
              {ru ? 'Искать везде' : 'Search everywhere'}
              <kbd className="ml-auto rounded-md border border-border px-1 text-caption text-muted">↵</kbd>
            </MenuItem>
          </div>
        </div>
      </OverlayPanel>
    </>
  )
}
