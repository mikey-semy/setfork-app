'use client'

import { useEffect, useRef, useState } from 'react'
import { useFormStatus } from 'react-dom'
import { Check, Loader2 } from 'lucide-react'
import { Button } from '@/shared/ui/button'

/**
 * ПОЛОСА СОХРАНЕНИЯ — у большого пальца, а не в конце простыни.
 *
 * Кнопка «Сохранить» стояла последней строкой формы. В секции с двумя десятками полей
 * это значит: переключил тумблер вверху, ушёл со страницы — и настройка не сохранилась,
 * потому что кнопка осталась в километре ниже. Ровно так владелец и потерял свой выбор.
 *
 * Поэтому кнопки в потоке нет вовсе. Пока форму не тронули — не показываем ничего;
 * как только что-то изменили, снизу экрана выезжает полоса «есть несохранённые
 * изменения» с «Сохранить» и «Отменить». Она видна с любого места формы, независимо от
 * её длины, и заодно отвечает на вопрос «я вообще что-то менял?».
 *
 * Почему не автосохранение на каждый чих: в этих формах есть ключи API и id папок —
 * поле в процессе набора представляет собой мусор, а пустое поле у ключей означает
 * «оставить прежний». Сохранять такое по таймеру нельзя.
 */
export function FormSaveBar({ ru }: { ru: boolean }) {
  const say = (en: string, rus: string) => (ru ? rus : en) // строки-аргументы, не тернар-с-литералами (i18n-lint)
  const anchor = useRef<HTMLDivElement>(null)
  const [dirty, setDirty] = useState(false)
  const { pending } = useFormStatus()
  const wasPending = useRef(false)

  useEffect(() => {
    const form = anchor.current?.closest('form')
    if (!form) return
    const touch = () => setDirty(true)
    form.addEventListener('input', touch)
    form.addEventListener('change', touch)
    return () => {
      form.removeEventListener('input', touch)
      form.removeEventListener('change', touch)
    }
  }, [])

  // Отправка завершилась (pending: true → false) — менять больше нечего.
  useEffect(() => {
    if (wasPending.current && !pending) setDirty(false)
    wasPending.current = pending
  }, [pending])

  const reset = () => {
    anchor.current?.closest('form')?.reset()
    setDirty(false)
  }

  return (
    <div ref={anchor}>
      {(dirty || pending) && (
        <div
          // data-sticky-input — общий признак нижней панели: по нему кнопка «наверх»
          // садится НАД полосой, а не поверх «Сохранить» (см. ScrollToTop).
          data-sticky-input
          className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-sm"
        >
          <div className="mx-auto flex max-w-[1400px] items-center justify-between gap-3 px-4 py-2.5 md:px-8">
            {/* На телефоне текста нет: там важнее две крупные кнопки, а не пояснение. */}
            <span className="hidden min-w-0 truncate text-[13px] text-ink-2 sm:inline">
              {say('Unsaved changes', 'Есть несохранённые изменения')}
            </span>
            <div className="flex flex-1 items-center justify-end gap-2 sm:flex-none">
              <Button type="button" variant="outline" size="md" onClick={reset} disabled={pending} className="h-11 max-sm:flex-1 sm:h-[38px]">
                {say('Discard', 'Отменить')}
              </Button>
              <Button type="submit" variant="primary" size="md" disabled={pending} className="h-11 max-sm:flex-1 sm:h-[38px]">
                {pending ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />}
                {say('Save', 'Сохранить')}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
