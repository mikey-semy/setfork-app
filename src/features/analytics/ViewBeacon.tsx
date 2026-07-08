'use client'

import { useEffect } from 'react'

// Маячок просмотра списка: один POST при открытии страницы. sendBeacon не
// блокирует навигацию и переживает уход со страницы; дедуп (день × посетитель)
// делает сервер, так что двойной эффект StrictMode безвреден.
export function ViewBeacon({ templateId }: { templateId: string }) {
  useEffect(() => {
    const body = JSON.stringify({ t: templateId })
    try {
      if (!navigator.sendBeacon?.('/api/track/view', body)) {
        void fetch('/api/track/view', { method: 'POST', body, keepalive: true }).catch(() => {})
      }
    } catch {
      // трекинг не должен ломать страницу
    }
  }, [templateId])
  return null
}
