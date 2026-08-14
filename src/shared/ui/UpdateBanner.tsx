'use client'

import { useEffect, useState } from 'react'
import { RefreshCw, TriangleAlert } from 'lucide-react'
import { APP_VERSION } from '@/shared/app-version'
import type { Lang } from '@/shared/i18n'
import { t } from '@/shared/i18n'
import { useViewportBottom } from './use-viewport-bottom'
import { buttonClass } from '@/shared/ui/button-style'

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
  // nextBuild — build-id серверной сборки, отличный от нашего: показываем короткий
  // хвост как «что именно изменилось» (semver 0.1.0 между деплоями не двигается).
  const [nextBuild, setNextBuild] = useState<string | null>(null)
  // bottom от ВИДИМОГО низа: иначе на мобиле баннер всплывал посередине экрана.
  const { gap } = useViewportBottom()

  useEffect(() => {
    if (build === 'dev' || nextBuild) return // dev пересобирается на лету; уже показали — хватит дёргать сеть
    let stop = false
    const check = async () => {
      if (stop || document.hidden) return
      try {
        const r = await fetch('/api/version', { cache: 'no-store' })
        if (!r.ok) return
        const d: { build?: string } = await r.json()
        if (d.build && d.build !== build) setNextBuild(d.build)
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
  }, [build, nextBuild])

  if (!nextBuild) return null
  return (
    // Прямоугольная карточка-предупреждение (не «таблетка»): жёлтый акцент слева,
    // иконка внимания, заголовок с версией, кнопка-иконка перезагрузки (без текста).
    <div
      role="alert"
      style={gap ? { bottom: gap + 16 } : undefined}
      className="fixed bottom-4 left-1/2 z-50 flex w-[min(92vw,400px)] -translate-x-1/2 animate-fadein items-start gap-3 border border-border border-l-2 border-l-warn bg-surface px-4 py-3 shadow-card"
    >
      <TriangleAlert size={18} className="mt-0.5 shrink-0 text-warn" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[0.8125rem] font-semibold text-ink">
          {t('ui.updateAvailable', lang)}
          <span className="font-mono text-[0.6875rem] font-medium text-ink-2">
            v{APP_VERSION} · {nextBuild.slice(0, 7)}
          </span>
        </div>
        <p className="mt-0.5 text-[0.78125rem] leading-snug text-ink-2">
          {t('ui.reloadPageSoEverything', lang)}
        </p>
      </div>
      <button
        type="button"
        onClick={() => window.location.reload()}
        aria-label={t('ui.reload', lang)}
        title={t('ui.reload', lang)}
        className={buttonClass({ variant: 'primary', className: 'self-center transition-opacity' })}
      >
        <RefreshCw size={16} />
      </button>
    </div>
  )
}
