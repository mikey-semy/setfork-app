'use client'

import { useState } from 'react'
import { Switch } from '@/shared/ui/switch'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select'
import { Field } from '@/shared/ui/Field'
import { t, type Lang } from '@/shared/i18n'
import { cardClass } from '@/shared/ui/card-style'

// Поля «Помощи на шаге» внутри формы AI-настроек (submit через setAiSettings).
// Тумблер — controlled Switch с name (submit 'on'/выкл), как в CouncilFields.

export interface AssistValues {
  enabled: boolean
  audience: 'admin' | 'all'
}

export function AssistFields({ v, lang }: { v: AssistValues; lang: Lang }) {
  const [enabled, setEnabled] = useState(v.enabled)

  return (
    <div className={cardClass({ tone: 'inset', pad: 'sm', className: 'space-y-4' })}>
      <div>
        <div className="text-body font-medium text-ink">{t('admin.stepAssistHelpWhen', lang)}</div>
        <p className="mt-0.5 text-body-sm text-muted">
          {t('admin.aHelpMeButton', lang)}
        </p>
      </div>

      <div className="flex items-center justify-between gap-4">
        <div className="text-body text-ink">{t('admin.enableStepAssist', lang)}</div>
        <Switch name="assistEnabled" checked={enabled} onCheckedChange={setEnabled} />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Field label={t('admin.audience', lang)}>
          <Select name="assistAudience" defaultValue={v.audience}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="admin">{t('admin.adminsOnly', lang)}</SelectItem>
              <SelectItem value="all">{t('admin.everyone', lang)}</SelectItem>
            </SelectContent>
          </Select>
        </Field>
      </div>
    </div>
  )
}
