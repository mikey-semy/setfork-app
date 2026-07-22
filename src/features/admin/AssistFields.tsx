'use client'

import { useState } from 'react'
import { Switch } from '@/shared/ui/switch'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select'

// Поля «Помощи на шаге» внутри формы AI-настроек (submit через setAiSettings).
// Тумблер — controlled Switch с name (submit 'on'/выкл), как в CouncilFields.
const lbl = 'mb-1.5 block text-[12.5px] font-semibold text-ink-2'

export interface AssistValues {
  enabled: boolean
  audience: 'admin' | 'all'
}

export function AssistFields({ v, ru }: { v: AssistValues; ru: boolean }) {
  const say = (en: string, rus: string) => (ru ? rus : en) // строки-аргументы, не тернар-с-литералами (i18n-lint)
  const [enabled, setEnabled] = useState(v.enabled)

  return (
    <div className="space-y-4 rounded-md border border-border bg-surface-2 p-3">
      <div>
        <div className="text-[13px] font-medium text-ink">{say('Step assist (help when stuck)', 'Помощь на шаге (застрявшему в прогоне)')}</div>
        <p className="mt-0.5 text-[12px] text-muted">
          {say(
            'A “Help me” button on run steps: one fast model call with step context + community pass/stuck counters. Short answer, hard timeout.',
            'Кнопка «Помоги» на шагах прогона: один быстрый вызов модели с контекстом шага + счётчиками «прошли/застряли». Короткий ответ, жёсткий таймаут.',
          )}
        </p>
      </div>

      <div className="flex items-center justify-between gap-4">
        <div className="text-[13.5px] text-ink">{say('Enable step assist', 'Включить помощь на шаге')}</div>
        <Switch name="assistEnabled" checked={enabled} onCheckedChange={setEnabled} />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={lbl}>{say('Audience', 'Аудитория')}</label>
          <Select name="assistAudience" defaultValue={v.audience}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="admin">{say('Admins only', 'Только админам')}</SelectItem>
              <SelectItem value="all">{say('Everyone', 'Всем')}</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
    </div>
  )
}
