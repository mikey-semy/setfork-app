'use client'

import { useEffect, useRef } from 'react'
import { hasPushSubscription } from './push-client'

type Recent = { id: string; body: string; url: string }

/**
 * Foreground-фолбэк браузерных уведомлений: если web-push НЕ подписан (нет VAPID /
 * отказ), пока вкладка открыта поллим свежие непрочитанные и показываем через
 * Notification API. Если push-подписка есть — ничего не делаем: SW покажет всё сам
 * (и при закрытой вкладке), без дублей.
 */
export function BrowserNotifier({ enabled }: { enabled: boolean }) {
  const seen = useRef<Set<string>>(new Set())
  const primed = useRef(false)

  useEffect(() => {
    if (!enabled || typeof window === 'undefined' || typeof Notification === 'undefined') return
    let stopped = false

    async function poll() {
      if (await hasPushSubscription()) return // push активен → foreground-поллинг не нужен
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
