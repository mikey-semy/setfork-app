'use client'

import { useEffect, useRef, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { t, type Lang } from '@/shared/i18n'

/** Поллинг /api/auth/telegram/poll: ждём подтверждение в боте → редирект. */
export function TelegramLoginWatcher({ lang }: { lang: Lang }) {
  const [expired, setExpired] = useState(false)
  const stopped = useRef(false)

  useEffect(() => {
    stopped.current = false
    const tick = async () => {
      if (stopped.current) return
      try {
        const res = await fetch('/api/auth/telegram/poll', { method: 'POST' })
        const j = (await res.json()) as { url?: string; error?: string; pending?: boolean }
        if (j.url) {
          stopped.current = true
          window.location.assign(j.url)
          return
        }
        if (j.error) {
          stopped.current = true
          setExpired(true)
          return
        }
      } catch {
        // сеть мигнула — следующий тик попробует снова
      }
      timer = window.setTimeout(tick, 2500)
    }
    let timer = window.setTimeout(tick, 2500)
    return () => {
      stopped.current = true
      window.clearTimeout(timer)
    }
  }, [])

  if (expired) {
    return <div className="text-[12.5px] text-danger">{t('tgLoginExpired', lang)}</div>
  }
  return (
    <div className="flex items-center justify-center gap-2 text-[12.5px] text-ink-2">
      <Loader2 size={14} className="animate-spin" aria-hidden />
      {t('tgLoginWaiting', lang)}
    </div>
  )
}
