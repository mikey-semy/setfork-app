'use client'

import { useState, useTransition } from 'react'
import { Sparkles } from 'lucide-react'
import { t, type Lang } from '@/shared/i18n'
import { startGeneration } from './actions'
import { GnomeLoader } from './GnomeLoader'

/**
 * Клиентская форма старта генерации: как только пользователь жмёт «Сгенерировать»,
 * СРАЗУ показываем лоадер (иначе несколько секунд «ничего не происходит», пока
 * серверный экшен ходит в ИИ). Реальная генерация → уместен гном-лоадер.
 */
export function GenerateForm({ lang, aiOn, defaultQuery }: { lang: Lang; aiOn: boolean; defaultQuery: string }) {
  const ru = lang === 'ru'
  const [q, setQ] = useState(defaultQuery)
  const [pending, start] = useTransition()

  function submit(e: React.FormEvent) {
    e.preventDefault()
    const query = q.trim()
    if (!query || !aiOn) return
    const fd = new FormData()
    fd.set('q', query)
    start(() => startGeneration(fd)) // экшен сам сделает redirect на /generate/[id]
  }

  if (pending) {
    return <GnomeLoader query={q.trim()} lang={lang} label={ru ? 'Генерируем черновик…' : 'Drafting your list…'} />
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <input
        name="q"
        required
        autoFocus
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={ru ? 'напр. Настроить nginx reverse proxy с TLS' : 'e.g. Set up an nginx reverse proxy with TLS'}
        className="w-full rounded-md border border-border bg-surface-2 px-3.5 py-3 text-[14px] text-ink outline-hidden focus:border-border-strong"
      />
      <button
        disabled={!aiOn || !q.trim()}
        className="inline-flex w-fit items-center gap-2 rounded-md bg-primary px-5 py-2.5 text-[14px] font-semibold text-primary-fg disabled:opacity-50"
      >
        <Sparkles size={15} /> {t('generateWithAi', lang)}
      </button>
    </form>
  )
}
