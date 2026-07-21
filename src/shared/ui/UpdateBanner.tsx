'use client'

import { useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import type { Lang } from '@/shared/i18n'

/**
 * «Вышло обновление» — детект устаревшей вкладки. После деплоя старые вкладки шлют
 * Server Actions по протухшим id и падают с UnrecognizedActionError (инцидент
 * 2026-07-21: любой клик по типу списка в чате генерации = ошибка). Сравниваем
 * build-id вкладки с сервером при возвращении в неё (visibilitychange/focus) и раз
 * в 5 минут; разошлись — предлагаем перезагрузить. Не перезагружаем сами: у
 * человека может быть недописанный текст в поле.
 */
const CHECK_MS = 5 * 60_000

export function UpdateBanner({ build, lang }: { build: string; lang: Lang }) {
  const say = (en: string, ru: string) => (lang === 'ru' ? ru : en) // строки-аргументами (i18n-lint)
  const [stale, setStale] = useState(false)

  useEffect(() => {
    if (build === 'dev' || stale) return // dev пересобирается на лету; уже показали — хватит дёргать сеть
    let stop = false
    const check = async () => {
      if (stop || document.hidden) return
      try {
        const r = await fetch('/api/version', { cache: 'no-store' })
        if (!r.ok) return
        const d: { build?: string } = await r.json()
        if (d.build && d.build !== build) setStale(true)
      } catch {
        // Сеть моргнула — проверим в следующий раз.
      }
    }
    const onVisible = () => {
      if (!document.hidden) void check()
    }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', onVisible)
    const timer = setInterval(check, CHECK_MS)
    return () => {
      stop = true
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', onVisible)
      clearInterval(timer)
    }
  }, [build, stale])

  if (!stale) return null
  return (
    <div className="fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 animate-fadein items-center gap-3 rounded-full border border-border bg-surface py-2 pl-4 pr-2 text-[13px] text-ink shadow-card">
      {say('SetFork was updated — reload to keep everything working.', 'Вышло обновление SetFork — перезагрузи, чтобы всё работало.')}
      <button
        type="button"
        onClick={() => window.location.reload()}
        className="inline-flex items-center gap-1.5 rounded-full bg-primary px-3 py-1.5 text-[12.5px] font-semibold text-primary-fg"
      >
        <RefreshCw size={13} /> {say('Reload', 'Перезагрузить')}
      </button>
    </div>
  )
}
