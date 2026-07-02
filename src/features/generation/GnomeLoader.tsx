'use client'

import { useEffect, useState } from 'react'
import { Sparkles } from 'lucide-react'
import type { Lang } from '@/shared/i18n'

// Пасхалка South Park (Underpants Gnomes): «Collect underpants → ? → Profit!».
// Шаг 2 крутит шуточные фразы, адаптирован к запросу пользователя.
const STEP2: Record<Lang, string[]> = {
  en: ['?', 'AI magic happens here', 'the neural net ponders', 'searching the web…', 'assembling the steps', 'checking the sources', '???'],
  ru: ['?', 'здесь магия нейросети', 'ИИ усиленно думает', 'ищем в интернете…', 'собираем шаги', 'сверяемся с источниками', '???'],
}

export function GnomeLoader({ query, lang, label }: { query: string; lang: Lang; label?: string }) {
  const [i, setI] = useState(0)
  const phrases = STEP2[lang] ?? STEP2.en
  useEffect(() => {
    const id = setInterval(() => setI((n) => (n + 1) % phrases.length), 900)
    return () => clearInterval(id)
  }, [phrases.length])

  const collect = lang === 'ru' ? 'Собрать' : 'Collect'
  const q = query.length > 60 ? query.slice(0, 60) + '…' : query

  return (
    <div className="rounded-lg border border-[var(--accent)] bg-[var(--accent-soft)] px-5 py-6">
      <div className="mb-3 flex items-center gap-2 text-[13px] font-semibold text-accent">
        <Sparkles size={15} className="animate-pulse" />
        {label ?? (lang === 'ru' ? 'Генерируем…' : 'Generating…')}
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
          <span className="text-accent transition-opacity">{phrases[i]}</span>
        </li>
        <li className="flex gap-2">
          <span className="text-muted">3.</span>
          <span className="font-semibold">Profit! ✨</span>
        </li>
      </ol>
    </div>
  )
}
