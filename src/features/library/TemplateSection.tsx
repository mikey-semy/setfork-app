'use client'

import { useState, useTransition } from 'react'
import { LayoutTemplate } from 'lucide-react'
import { Switch } from '@/shared/ui/switch'
import type { Lang } from '@/shared/i18n'
import { setListTemplate } from './actions'
import { cardClass } from '@/shared/ui/card-style'

/** Настройки списка → «Шаблон»: включает кнопку «Use this template»
 *  (копия текущей версии БЕЗ fork-связи — стартовая точка для своих списков). */
export function TemplateSection({ templateId, isTemplate, lang }: { templateId: string; isTemplate: boolean; lang: Lang }) {
  const ru = lang === 'ru'
  const [on, setOn] = useState(isTemplate)
  const [, start] = useTransition()

  return (
    <section className={cardClass({ pad: 'lg' })}>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2 font-semibold text-ink">
            <LayoutTemplate size={15} className="text-muted" /> {ru ? 'Список-шаблон' : 'Template list'}
          </div>
          <p className="mt-1 text-body-sm leading-snug text-ink-2">
            {ru
              ? 'На странице появится кнопка «Использовать шаблон»: любой создаст свой список из текущей версии — без fork-связи с этим.'
              : 'Shows a “Use this template” button: anyone can start their own list from the current version — with no fork relation to this one.'}
          </p>
        </div>
        <Switch
          checked={on}
          onCheckedChange={(v) => {
            setOn(v)
            start(() => setListTemplate(templateId, v))
          }}
        />
      </div>
    </section>
  )
}
