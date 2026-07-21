'use client'

import { useState, useTransition } from 'react'
import { ChevronRight, Loader2, Pickaxe } from 'lucide-react'
import type { Lang } from '@/shared/i18n'
import { Markdown } from '@/shared/ui/Markdown'
import { digDeeper, type DigLayerRow } from './actions'

/**
 * «Копать глубже» под шагом (HQ §8): аккордеон слоёв + кнопка следующего слоя.
 * Один клик = один слой (остановки = бюджетный предохранитель). Выкопанное
 * хранится и видно всем — «шахта остаётся», следующий читатель идёт бесплатно.
 */
const MAX_LEVEL = 3

export function DigPanel({
  templateId,
  stepN,
  initial,
  canDig,
  lang,
}: {
  templateId: string
  stepN: number
  initial: DigLayerRow[]
  canDig: boolean
  lang: Lang
}) {
  const say = (en: string, ru: string) => (lang === 'ru' ? ru : en) // строки-аргументами (i18n-lint)
  const [layers, setLayers] = useState<DigLayerRow[]>(initial)
  const [open, setOpen] = useState(false)
  const [err, setErr] = useState('')
  const [pending, start] = useTransition()

  const levelTitle = (lv: number) =>
    lv === 1 ? say('Reasons & sources', 'Причины и источники') : lv === 2 ? say('Mechanism & exceptions', 'Механизм и исключения') : say('Fine points', 'Тонкости')

  const errText: Record<string, string> = {
    ai_off: say('Drafting is not configured.', 'ИИ не настроен.'),
    budget: say('AI budget is exhausted for today.', 'Дневной бюджет ИИ исчерпан.'),
    quota: say('Your monthly AI quota is used up.', 'Твоя месячная ИИ-квота исчерпана.'),
    ratelimited: say('Too fast — wait a minute.', 'Слишком часто — подожди минуту.'),
    aifail: say('The digger could not finish — try again.', 'Копатель не справился — попробуй ещё раз.'),
    'not found': say('Step not found.', 'Шаг не найден.'),
  }

  const dig = () => {
    setErr('')
    start(async () => {
      const res = await digDeeper(templateId, stepN, lang)
      if ('error' in res) setErr(errText[res.error] ?? res.error)
      else {
        setLayers(res.layers)
        setOpen(true)
      }
    })
  }

  if (!canDig && layers.length === 0) return null
  return (
    <div className="mt-3">
      <div className="flex items-center gap-2">
        {layers.length > 0 && (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="inline-flex items-center gap-1 rounded-md py-0.5 text-[11.5px] text-muted hover:text-ink-2"
          >
            <ChevronRight size={12} className={`transition-transform ${open ? 'rotate-90' : ''}`} />
            {say(`Mine: ${layers.length}`, `Шахта: ${layers.length}`)}
          </button>
        )}
        {canDig && layers.length < MAX_LEVEL && (
          <button
            type="button"
            onClick={dig}
            disabled={pending}
            className="inline-flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-[11.5px] text-ink-2 hover:border-border-strong hover:text-ink disabled:opacity-50"
          >
            {pending ? <Loader2 size={12} className="animate-spin" /> : <Pickaxe size={12} />}
            {layers.length === 0 ? say('Dig deeper', 'Копнуть глубже') : say(`Dig lower (${layers.length}/${MAX_LEVEL})`, `Копаем ниже (${layers.length}/${MAX_LEVEL})`)}
          </button>
        )}
        {err && <span className="text-[11.5px] text-warn">{err}</span>}
      </div>
      {open && layers.length > 0 && (
        <div className="mt-2 space-y-2 border-l-2 border-border pl-3">
          {layers.map((l) => (
            <div key={l.level}>
              <div className="mb-0.5 text-[10.5px] font-semibold uppercase tracking-wide text-muted">
                {say(`Layer ${l.level}`, `Слой ${l.level}`)} · {levelTitle(l.level)}
              </div>
              <Markdown className="text-[12.5px] leading-relaxed text-ink-2">{l.content}</Markdown>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
