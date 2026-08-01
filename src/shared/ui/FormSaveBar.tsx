'use client'

import { useEffect, useRef, useState } from 'react'
import { useFormStatus } from 'react-dom'
import { Check, Loader2 } from 'lucide-react'
import { Button } from '@/shared/ui/button'
import { t, type Lang } from '@/shared/i18n'

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
 *
 * «Изменили» считаем СНИМКОМ значений, а не событиями input/change. Половина полей тут
 * — свои компоненты (выбор модели, тумблеры): они пишут значение в скрытый input через
 * React, а DOM-событие при этом не возникает. На событиях полоса не появилась бы при
 * смене модели вообще — то есть модель стало бы не сохранить (P1 из авто-ревью).
 * Снимок ловит любое изменение, откуда бы оно ни пришло, и сам гаснет, если значения
 * вернули к исходным.
 */

/**
 * Снимок значений формы. Файлы пропускаем (в настройках их нет, а читать их для
 * сравнения дорого и бессмысленно), флажки берём по checked.
 */
function snapshot(form: HTMLFormElement): string {
  const parts: string[] = []
  for (const el of Array.from(form.elements)) {
    const f = el as HTMLInputElement
    if (!f.name || f.type === 'file' || f.type === 'submit' || f.type === 'button') continue
    parts.push(`${f.name}=${f.type === 'checkbox' || f.type === 'radio' ? String(f.checked) : f.value}`)
  }
  return parts.join('&')
}

export function FormSaveBar({ lang }: { lang: Lang }) {  const anchor = useRef<HTMLDivElement>(null)
  const [dirty, setDirty] = useState(false)
  const { pending } = useFormStatus()
  const saved = useRef('')
  const touched = useRef(false)

  useEffect(() => {
    const form = anchor.current?.closest('form')
    if (!form) return
    saved.current = snapshot(form)
    // Пока форму не тронули, снимок ПЕРЕСНИМАЕМ: свои компоненты дописывают значения в
    // скрытые input уже после монтирования, и без этого полоса всплывала бы сразу при
    // открытии страницы — «есть несохранённые изменения», которых никто не делал.
    // Правкой считается то, что произошло после первого касания формы.
    const check = () => {
      if (!touched.current) {
        saved.current = snapshot(form)
        return
      }
      setDirty(snapshot(form) !== saved.current)
    }
    const touch = () => {
      touched.current = true
      check()
    }
    form.addEventListener('pointerdown', touch)
    form.addEventListener('keydown', touch)
    form.addEventListener('input', touch)
    form.addEventListener('change', touch)
    // Опрос — ради полей, которые меняются программно (свои компоненты пишут в скрытый
    // input через React, событий не шлют). Полсекунды на десяток строк — незаметно.
    const timer = setInterval(check, 500)
    return () => {
      form.removeEventListener('pointerdown', touch)
      form.removeEventListener('keydown', touch)
      form.removeEventListener('input', touch)
      form.removeEventListener('change', touch)
      clearInterval(timer)
    }
  }, [])

  // Отправка завершилась (pending: true → false) — то, что на экране, теперь и есть
  // сохранённое: берём новый эталон, иначе полоса висела бы вечно (снимок-то изменился).
  const wasPending = useRef(false)
  useEffect(() => {
    const done = wasPending.current && !pending
    wasPending.current = pending
    if (!done) return
    const form = anchor.current?.closest('form')
    if (form) saved.current = snapshot(form)
    touched.current = false
    setDirty(false)
  }, [pending])

  // «Отменить» — перезагрузка страницы, а не form.reset(). reset() возвращает только
  // нативные поля: состояние своих компонентов (выбранная модель, тумблеры) осталось бы
  // изменённым, полоса бы погасла, и «отменённое» уехало бы со следующим сохранением.
  const discard = () => window.location.reload()

  return (
    <div ref={anchor}>
      {(dirty || pending) && (
        <div
          // data-sticky-input — общий признак нижней панели: по нему кнопка «наверх»
          // садится НАД полосой, а не поверх «Сохранить» (см. ScrollToTop).
          data-sticky-input
          className="sf-rise-in fixed inset-x-0 bottom-0 z-30 border-t border-border bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-sm"
        >
          <div className="mx-auto flex max-w-[87.5rem] items-center justify-between gap-3 px-4 py-2.5 md:px-8">
            {/* На телефоне текста нет: там важнее две крупные кнопки, а не пояснение. */}
            <span className="hidden min-w-0 truncate text-[0.8125rem] text-ink-2 sm:inline">
              {t('ui.unsavedChanges', lang)}
            </span>
            <div className="flex flex-1 items-center justify-end gap-2 sm:flex-none">
              <Button type="button" variant="outline" size="md" onClick={discard} disabled={pending} className="h-11 max-sm:flex-1 sm:h-[2.375rem]">
                {t('ui.discard', lang)}
              </Button>
              <Button type="submit" variant="primary" size="md" disabled={pending} className="h-11 max-sm:flex-1 sm:h-[2.375rem]">
                {pending ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />}
                {t('common.save', lang)}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
