'use client'

import { useState, useTransition } from 'react'
import { Radio } from 'lucide-react'
import { Switch } from '@/shared/ui/switch'
import { t, tr, type Lang } from '@/shared/i18n'
import { setListLiving } from './actions'

/**
 * Настройки списка → «Живой список» (лента).
 *
 * Признак меняет не оформление, а правила: такой список судится СВЕЖЕСТЬЮ вместо полноты,
 * не «устаивается» (значит и форком от него не расходятся), и уход ДОБАВЛЯЕТ в него новое по
 * теме вместо полировки старого.
 *
 * Выключатель нужен именно человеку: список, выросший из события, помечается живым
 * автоматически, и это догадка. Ошиблись — владелец снимает признак одним касанием.
 */
export function LivingSection({ templateId, living, lang }: { templateId: string; living: boolean; lang: Lang }) {
  // Оптимистичное значение поверх пропа, а не копия пропа: useState(living) держал бы старое
  // значение после ревалидации страницы (react-doctor/no-derived-useState).
  const [pending, setPending] = useState<boolean | null>(null)
  const [, start] = useTransition()
  const on = pending ?? living

  return (
    <section className="rounded-lg border border-border bg-surface p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2 font-semibold text-ink">
            <Radio size={15} className="text-muted" /> {t('common.livingList', lang)}
          </div>
          <p className="mt-1 text-[0.78125rem] leading-snug text-ink-2">
            {t('library.aListTopicKeeps', lang)}
          </p>
        </div>
        <Switch
          checked={on}
          onCheckedChange={(v) => {
            setPending(v)
            start(async () => {
              await setListLiving(templateId, v)
              setPending(null) // дальше показываем то, что реально в базе
            })
          }}
        />
      </div>
    </section>
  )
}
