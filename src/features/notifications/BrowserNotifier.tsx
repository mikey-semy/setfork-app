'use client'

import { useEffect, useRef } from 'react'

type Recent = { id: string; body: string; url: string }

/**
 * Браузерные (нативные) уведомления в foreground: пока вкладка открыта и включён
 * тумблер `browser`, поллим свежие непрочитанные и показываем их через Notification API.
 * Первый проход «праймит» уже существующие (без спама), дальше — только новые.
 */
export function BrowserNotifier({ enabled }: { enabled: boolean }) {
  const seen = useRef<Set<string>>(new Set())
  const primed = useRef(false)

  useEffect(() => {
    if (!enabled || typeof window === 'undefined' || typeof Notification === 'undefined') return
    let stopped = false

    async function poll() {
      if (stopped || Notification.permission !== 'granted' || document.hidden) return
      try {
        const res = await fetch('/api/notifications/recent', { cache: 'no-store' })
        if (!res.ok) return
        const { items } = (await res.json()) as { items: Recent[] }
        if (!primed.current) {
          items.forEach((i) => seen.current.add(i.id)) // старые не показываем
          primed.current = true
          return
        }
        for (const it of items) {
          if (seen.current.has(it.id)) continue
          seen.current.add(it.id)
          const n = new Notification('SetFork', { body: it.body, tag: it.id })
          n.onclick = () => {
            window.focus()
            window.location.href = it.url
            n.close()
          }
        }
      } catch {
        /* сеть/парсинг — не критично */
      }
    }

    void poll()
    const id = window.setInterval(poll, 30000)
    return () => {
      stopped = true
      window.clearInterval(id)
    }
  }, [enabled])

  return null
}
