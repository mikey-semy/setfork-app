'use client'

import { useRef, useState } from 'react'
import { Loader2, Sparkles } from 'lucide-react'
import { t, type Lang } from '@/shared/i18n'
import { Tooltip } from '@/shared/ui/Tooltip'
import { generateChangeNoteAction } from './actions'
import { buttonClass } from '@/shared/ui/button-style'
import { TOUCH_HIT } from '@/shared/ui/control'

// Поле «Что изменили и почему» + кнопка генерации примечания из диффа версий
// (как commit-message в Copilot). Читает текущие пункты из скрытого поля формы.
export function ChangeNoteField({
  templateId,
  lang,
  placeholder,
  required = true,
  initial = '',
}: {
  templateId: string
  lang: Lang
  placeholder: string
  /** Уже написанная заметка (из черновика): без неё повторное сохранение затирало
   *  её пустотой — поле контролируемое и стартовало с ''. */
  initial?: string
  /** Обязательна ли заметка. У черновика — нет: он копится, а описывают правку при
   *  публикации. Обязательное поле здесь просто не давало сохранить черновик. */
  required?: boolean
}) {
  const [note, setNote] = useState(initial)
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
      // «Изменений нет» — не сбой ИИ, а факт: описывать нечего, и модель не звалась
      // вовсе. Раньше в этом случае она сочиняла совет вместо описания правки.
      const key = res.error === 'nochange' ? 'changeNoteNothing' : res.error === 'ratelimited' ? 'changeNoteTooOften' : 'changeNoteFailed'
      setErr(t(key, lang))
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
          required={required}
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
          className={`w-full rounded-md border bg-surface-2 py-2.5 pl-3 pr-11 text-[0.875rem] text-ink outline-hidden ${
            invalid ? 'border-danger focus:border-danger' : 'border-border focus:border-border-strong'
          }`}
        />
        {/* Иконка-генерация внутри инпута справа, как commit-message в VSCode */}
        <Tooltip label={t('generateFromChanges', lang)}>
          <button
            type="button"
            onClick={generate}
            disabled={busy}
            aria-label={t('generateFromChanges', lang)}
            className={`${buttonClass({ variant: 'ghost', size: 'sm', className: `absolute right-1.5 top-1/2 size-7 -translate-y-1/2 p-0 ${TOUCH_HIT}` })} hover:bg-surface hover:text-accent disabled:cursor-default disabled:opacity-50 disabled:hover:bg-transparent disabled:hover:text-ink-2`}
          >
            {busy ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />}
          </button>
        </Tooltip>
      </div>
      {invalid && <p className="mt-1 text-[0.78125rem] text-danger">{t('changeNoteRequired', lang)}</p>}
      {err && <p className="mt-1 text-[0.78125rem] text-danger">{err}</p>}
    </div>
  )
}
