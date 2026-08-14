'use client'

import { useState, useTransition } from 'react'
import { Loader2, Wrench } from 'lucide-react'
import { t, type Lang } from '@/shared/i18n'
import { toggleMaintenance } from './actions'
import { buttonClass } from '@/shared/ui/button-style'

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
        <span className={`text-[0.8125rem] font-semibold ${on || envOverride ? 'text-warn' : 'text-ink'}`}>
          {on || envOverride ? t('maintenanceStateOn', lang) : t('maintenanceStateOff', lang)}
        </span>
      </div>
      {envOverride ? (
        <span className="text-[0.78125rem] text-muted">{t('maintenanceEnvNote', lang)}</span>
      ) : (
        <button
          type="button"
          onClick={flip}
          disabled={pending}
          className={`${buttonClass()} disabled:opacity-50 ${
            on ? 'bg-primary text-primary-fg' : 'bg-danger text-white hover:opacity-90'
          }`}
        >
          {pending && <Loader2 size={14} className="animate-spin" />}
          {on ? t('maintenanceDisable', lang) : t('maintenanceEnable', lang)}
        </button>
      )}
      <p className="w-full text-[0.78125rem] text-ink-2">{t('maintenanceHint', lang)}</p>
    </div>
  )
}
