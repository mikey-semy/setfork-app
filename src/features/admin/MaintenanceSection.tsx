'use client'

import { useState, useTransition } from 'react'
import { Wrench } from 'lucide-react'
import { t, type Lang } from '@/shared/i18n'
import { toggleMaintenance } from './actions'
import { buttonClass } from '@/shared/ui/button-style'
import { Spinner } from '@/shared/ui/Spinner'

/** Тумблер «сайт на ремонте». Админ при включённом режиме ходит по сайту
 *  свободно (байпас в middleware) и выключает режим здесь же. envOverride —
 *  аварийный SETFORK_MAINTENANCE=1: из UI не снимается, только env стенда. */
export function MaintenanceSection({ initialOn, envOverride, lang }: { initialOn: boolean; envOverride: boolean; lang: Lang }) {
  const [on, setOn] = useState(initialOn)
  const [pending, start] = useTransition()

  const flip = () =>
    start(async () => {
      const next = await toggleMaintenance(!on)
      setOn(next)
    })

  return (
    <div className="flex flex-wrap items-center gap-4">
      <div className="flex items-center gap-2.5">
        <Wrench size={18} className={on || envOverride ? 'text-warn' : 'text-muted'} />
        <span className={`text-body font-semibold ${on || envOverride ? 'text-warn' : 'text-ink'}`}>
          {on || envOverride ? t('maintenanceStateOn', lang) : t('maintenanceStateOff', lang)}
        </span>
      </div>
      {envOverride ? (
        <span className="text-body-sm text-muted">{t('maintenanceEnvNote', lang)}</span>
      ) : (
        <button
          type="button"
          onClick={flip}
          disabled={pending}
          // ⚠️ ВАРИАНТОМ, А НЕ ДОПИСАННЫМИ КЛАССАМИ. Раньше цвет дописывали строкой
          // поверх `buttonClass()`: строка склеивается как есть, без tailwind-merge,
          // поэтому у кнопки оставались ОБА набора — `bg-surface-2 text-ink` из
          // варианта по умолчанию и `bg-danger text-white` сверху. Кто победит,
          // решает порядок правил в собранном CSS, а не порядок в строке: вышло
          // белым по белому, текста не видно (снимок владельца 02.09.2026).
          className={buttonClass({
            variant: on ? 'primary' : 'dangerSolid',
            className: 'disabled:opacity-50',
          })}
        >
          {pending && <Spinner size="md" />}
          {on ? t('maintenanceDisable', lang) : t('maintenanceEnable', lang)}
        </button>
      )}
      <p className="w-full text-body-sm text-ink-2">{t('maintenanceHint', lang)}</p>
    </div>
  )
}
