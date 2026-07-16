'use client'

import { useEffect, useState } from 'react'
import { Sparkles } from 'lucide-react'
import type { Lang } from '@/shared/i18n'
import type { CouncilEvent } from '@/shared/ai/council-progress'
import { CouncilBubble } from './CouncilBubble'

// Пасхалка South Park (Underpants Gnomes): «Collect underpants → ? → Profit!».
// Шаг 2 крутит шуточные фразы, адаптирован к запросу пользователя.
// en обязателен (фолбэк для любого языка), остальные — по мере добавления.
const STEP2: { en: string[] } & Partial<Record<Lang, string[]>> = {
  en: ['?', 'weighing the options', 'thinking it through', 'searching the web…', 'assembling the steps', 'checking the sources', '???'],
  ru: ['?', 'взвешиваем варианты', 'обдумываем', 'ищем в интернете…', 'собираем шаги', 'сверяемся с источниками', '???'],
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

  // Беседа совета: если воркер прислал ход — рисуем ЖИВОЙ чат вместо мема.
  // Все реплики слева: пользователь в этой беседе не участник, он наблюдатель (его ход — только в уточнениях).
  if (events && events.length) {
    return (
      <div className="rounded-lg border border-(--accent) bg-(--accent-soft) px-3 py-4 sm:px-5">
        <div className="mb-3 flex items-center gap-2 text-[13px] font-semibold text-accent">
          <Sparkles size={15} className="animate-pulse" />
          {label ?? say('The expert council confers…', 'Совет экспертов совещается…')}
        </div>
        <ol className="space-y-2.5">
          {events.map((e, idx) => {
            const last = idx === events.length - 1
            return (
              // key по ts+idx стабилен → анимация проигрывается только у НОВОЙ реплики, старые не мигают на каждом поллинге
              <li key={`${e.ts}-${idx}`} className="animate-fadein">
                <CouncilBubble who={e.who} name={e.name} typing={last}>
                  {e.text}
                </CouncilBubble>
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
        {label ?? say('Working on it…', 'Придумываем…')}
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
