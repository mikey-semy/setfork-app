'use client'

import { useRef, useState } from 'react'
import { Loader2, Sparkles } from 'lucide-react'
import type { Lang } from '@/shared/i18n'
import { generateChangeNoteAction } from './actions'

// Поле «Что изменили и почему» + кнопка генерации примечания из диффа версий
// (как commit-message в Copilot). Читает текущие пункты из скрытого поля формы.
export function ChangeNoteField({
  templateId,
  lang,
  placeholder,
}: {
  templateId: string
  lang: Lang
  placeholder: string
}) {
  const ru = lang === 'ru'
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const ref = useRef<HTMLInputElement>(null)

  async function generate() {
    if (busy) return
    const itemsInput = ref.current?.closest('form')?.querySelector('input[name="items"]') as HTMLInputElement | null
    const itemsJson = itemsInput?.value ?? '[]'
    setBusy(true)
    setErr('')
    const res = await generateChangeNoteAction(templateId, itemsJson)
    setBusy(false)
    if ('error' in res) {
      setErr(res.error === 'ratelimited' ? (ru ? 'Слишком часто — подожди.' : 'Too many requests.') : ru ? 'Не удалось сгенерировать.' : 'Could not generate.')
      return
    }
    setNote(res.note)
  }

  return (
    <div className="mb-4">
      <div className="flex items-center gap-2">
        <input
          ref={ref}
          name="note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder={placeholder}
          className="w-full rounded-md border border-border bg-surface-2 px-3 py-2.5 text-[14px] text-ink outline-none focus:border-border-strong"
        />
        <button
          type="button"
          onClick={generate}
          disabled={busy}
          title={ru ? 'Сгенерировать из изменений' : 'Generate from changes'}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-[var(--accent)] bg-[var(--accent-soft)] px-3 py-2.5 text-[13px] font-semibold text-accent disabled:opacity-50"
        >
          {busy ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
          {busy ? (ru ? 'Пишу…' : 'Writing…') : ru ? 'Сгенерировать' : 'Generate'}
        </button>
      </div>
      {err && <p className="mt-1 text-[12px] text-[var(--danger)]">{err}</p>}
    </div>
  )
}
