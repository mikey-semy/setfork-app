'use client'

import { useRef, useState } from 'react'
import { cn } from '@/shared/lib/cn'
import { Sparkles } from 'lucide-react'
import { t, type Lang } from '@/shared/i18n'
import { Tooltip } from '@/shared/ui/Tooltip'
import { generateChangeNoteAction } from './actions/ai'
import { buttonClass } from '@/shared/ui/button-style'
import { Spinner } from '@/shared/ui/Spinner'
import { Input } from '@/shared/ui/input'

// Поле «Что изменили и почему» + кнопка генерации примечания из диффа версий
// (как commit-message в Copilot). Читает текущие пункты из скрытого поля формы.
export function ChangeNoteField({
  templateId,
  lang,
  placeholder,
  required = true,
  initial = '',
  className,
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
  /** Для места вызова: поле встаёт в ряд с кнопкой настроек и собственный отступ снизу там лишний. */
  className?: string
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
    <div className={cn('mb-4', className)}>
      <div className="relative">
        <Input
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
          size="lg"
          className={`pr-11 ${invalid ? 'border-danger focus:border-danger' : ''}`}
        />
        {/* Иконка-генерация внутри инпута справа, как commit-message в VSCode.
            ⚠️ ЗОНА НАЖАТИЯ — ЧЕРЕЗ ПРОП `touch`, А НЕ КОНСТАНТОЙ В className. Строка
            `TOUCH_HIT` начинается с `pointer-coarse:relative`, и подставленная руками
            она побеждала здешний `absolute` — но ТОЛЬКО на грубом указателе. Кнопка
            выпадала в поток и оказывалась слева под полем: на телефоне владельца
            именно так, на десктопе всё выглядело правильно (снимок 01.09.2026).
            `buttonClass` этот случай знает и при собственном позиционировании берёт
            зону БЕЗ `relative` — если сказать ему `touch`, а не обходить его. */}
        <Tooltip label={t('generateFromChanges', lang)}>
          <button
            type="button"
            onClick={generate}
            disabled={busy}
            aria-label={t('generateFromChanges', lang)}
            className={buttonClass({
              variant: 'ghost',
              size: 'sm',
              touch: 'hit',
              // Всё своё — ВНУТРЬ `className`: снаружи классы не сливаются с вариантом,
              // и `hover:` из ghost остался бы спорить с этим в собранном CSS.
              className: 'absolute right-1.5 top-1/2 size-7 -translate-y-1/2 p-0 hover:bg-surface hover:text-accent disabled:cursor-default disabled:opacity-50 disabled:hover:bg-transparent disabled:hover:text-ink-2',
            })}
          >
            {busy ? <Spinner size="md" /> : <Sparkles size={15} />}
          </button>
        </Tooltip>
      </div>
      {invalid && <p className="mt-1 text-body-sm text-danger">{t('changeNoteRequired', lang)}</p>}
      {err && <p className="mt-1 text-body-sm text-danger">{err}</p>}
    </div>
  )
}
