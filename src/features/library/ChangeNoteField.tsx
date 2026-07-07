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
  const [invalid, setInvalid] = useState(false)
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
    setInvalid(false)
  }

  return (
    <div className="mb-4">
      <div className="relative">
        <input
          ref={ref}
          name="note"
          required
          value={note}
          onChange={(e) => {
            setNote(e.target.value)
            if (e.target.value.trim()) setInvalid(false)
          }}
          // Гасим нативный пузырёк валидации и показываем свой: подсветка + плавный скролл.
          onInvalid={(e) => {
            e.preventDefault()
            setInvalid(true)
            ref.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
            ref.current?.focus({ preventScroll: true })
          }}
          aria-invalid={invalid}
          placeholder={placeholder}
          className={`w-full rounded-md border bg-surface-2 py-2.5 pl-3 pr-11 text-[14px] text-ink outline-none ${
            invalid ? 'border-danger focus:border-danger' : 'border-border focus:border-border-strong'
          }`}
        />
        {/* Иконка-генерация внутри инпута справа, как commit-message в VSCode */}
        <button
          type="button"
          onClick={generate}
          disabled={busy}
          title={ru ? 'Сгенерировать из изменений' : 'Generate commit message from changes'}
          aria-label={ru ? 'Сгенерировать из изменений' : 'Generate commit message from changes'}
          className="absolute right-1.5 top-1/2 grid h-7 w-7 -translate-y-1/2 place-items-center rounded text-ink-2 transition-colors hover:bg-surface hover:text-accent disabled:cursor-default disabled:opacity-50 disabled:hover:bg-transparent disabled:hover:text-ink-2"
        >
          {busy ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />}
        </button>
      </div>
      {invalid && <p className="mt-1 text-[12px] text-danger">{ru ? 'Опишите, что изменили и почему.' : 'Describe what you changed and why.'}</p>}
      {err && <p className="mt-1 text-[12px] text-danger">{err}</p>}
    </div>
  )
}
