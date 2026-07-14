'use client'

import { useEffect, useState } from 'react'
import { Loader2, Sparkles } from 'lucide-react'
import type { Lang } from '@/shared/i18n'
import type { CouncilEvent } from '@/shared/ai/council-progress'

// Пасхалка South Park (Underpants Gnomes): «Collect underpants → ? → Profit!».
// Шаг 2 крутит шуточные фразы, адаптирован к запросу пользователя.
// en обязателен (фолбэк для любого языка), остальные — по мере добавления.
const STEP2: { en: string[] } & Partial<Record<Lang, string[]>> = {
  en: ['?', 'the gnomes confer', 'a gnome ponders hard', 'searching the web…', 'assembling the steps', 'checking the sources', '???'],
  ru: ['?', 'гномы совещаются', 'гном усиленно думает', 'ищем в интернете…', 'собираем шаги', 'сверяемся с источниками', '???'],
}

// Фразы меняем НЕ спеша (болтанка раз в ~0.9с раздражала): спокойный переход раз в 8с.
const ROTATE_MS = 8000

export function GnomeLoader({ query, lang, label, events }: { query: string; lang: Lang; label?: string; events?: CouncilEvent[] }) {
  const [i, setI] = useState(0)
  const phrases = STEP2[lang] ?? STEP2.en
  useEffect(() => {
    const id = setInterval(() => setI((n) => (n + 1) % phrases.length), ROTATE_MS)
    return () => clearInterval(id)
  }, [phrases.length])

  const say = (en: string, ru: string) => (lang === 'ru' ? ru : en) // строки-аргументы, не тернар-с-литералами (i18n-lint)

  // «Театр беседы совета»: если воркер прислал ход совета — рисуем ЖИВУЮ ленту вместо мема.
  if (events && events.length) {
    return (
      <div className="rounded-lg border border-(--accent) bg-(--accent-soft) px-5 py-6">
        <div className="mb-3 flex items-center gap-2 text-[13px] font-semibold text-accent">
          <Sparkles size={15} className="animate-pulse" />
          {label ?? say('The gnome council confers…', 'Совет гномов совещается…')}
        </div>
        <ol className="space-y-1.5 text-[13px]">
          {events.map((e, idx) => {
            const last = idx === events.length - 1
            return (
              <li key={`${e.ts}-${idx}`} className="flex items-start gap-2">
                <span className="mt-px w-3.5 shrink-0 text-center text-muted">
                  {last ? <Loader2 size={13} className="animate-spin text-accent" /> : '·'}
                </span>
                <span className={last ? 'text-accent' : 'text-ink-2'}>{e.text}</span>
              </li>
            )
          })}
        </ol>
      </div>
    )
  }

  // Фолбэк: мем-лоадер (совет выключен, или лента пока пуста / пришла на другой инстанс).
  const collect = say('Collect', 'Собрать')
  const q = query.length > 60 ? query.slice(0, 60) + '…' : query

  return (
    <div className="rounded-lg border border-(--accent) bg-(--accent-soft) px-5 py-6">
      <div className="mb-3 flex items-center gap-2 text-[13px] font-semibold text-accent">
        <Sparkles size={15} className="animate-pulse" />
        {label ?? say('The gnomes are at work…', 'Гномы за работой…')}
      </div>
      <ol className="space-y-2 font-mono text-[13.5px] text-ink">
        <li className="flex gap-2">
          <span className="text-muted">1.</span>
          <span>
            {collect} <span className="font-semibold">“{q}”</span>
          </span>
        </li>
        <li className="flex gap-2">
          <span className="text-muted">2.</span>
          {/* key={i} → перемонтирование запускает fade-in на каждой смене фразы */}
          <span key={i} className="animate-fadein text-accent">
            {phrases[i]}
          </span>
        </li>
        <li className="flex gap-2">
          <span className="text-muted">3.</span>
          <span className="font-semibold">Profit! ✨</span>
        </li>
      </ol>
    </div>
  )
}
