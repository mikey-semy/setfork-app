'use client'

import { useActionState, useState } from 'react'
import { Sparkles } from 'lucide-react'
import { Input } from '@/shared/ui/input'
import { buttonClass } from '@/shared/ui/button-style'
import { t, type Lang } from '@/shared/i18n'
import { expressProInterest, type ProInterestResult } from './pro-interest'

/**
 * FAKE DOOR «ХОЧУ PRO» — замер спроса без платёжки (решение 0021).
 *
 * ⚠️ ГОВОРИТ, ЧТО ОПЛАТЫ ПОКА НЕТ, и это не оговорка мелким шрифтом, а условие
 * честности замера. Без этой строки человек уходит ждать письма о запуске, а мы считаем
 * его готовность платить — то есть меряем не то, что думаем, и решение о деньгах
 * принимаем по собственному обещанию.
 *
 * Стоит там, где человек УПЁРСЯ в ограничение: интерес к платному тарифу возникает в
 * этот момент, а не на витрине. Отдельного раздела «тарифы» не заводим — поверхность
 * заморожена, да и мерить надо спрос, а не посещаемость страницы.
 *
 * ⚠️ БЕЗ СОБСТВЕННОГО <form>, И ЭТО НЕ СТИЛЬ. Блок показывается ВНУТРИ формы создания
 * списка, а вложенные формы запрещены HTML: браузер их разлепляет, и отправка молча не
 * происходит — поймано живой проверкой (React ругался «form cannot contain a nested
 * form», заявка в базу не попадала). Поэтому поле управляемое, а отправку делает кнопка
 * через `useTransition`.
 */
/**
 * ⚠️ РЕЗУЛЬТАТ ЖИВЁТ В СОСТОЯНИИ ДЕЙСТВИЯ, а не в обычном `useState`. Отправка —
 * серверное действие: оно обновляет дерево, и обычное состояние вместе с состоянием
 * РОДИТЕЛЯ теряется — сообщение о пределе исчезает, и подтверждение повисает без
 * контекста, из-за чего оно вообще появилось. Проверено снятием: замена на `useState`
 * воспроизводит пропажу.
 *
 * Диспетчер зовётся вручную из `startTransition`, а не через `<form action>`: блок
 * показывается ВНУТРИ формы создания списка, а вложенные формы запрещены HTML — браузер
 * их разлепляет, и отправка молча не происходит (это был первый из трёх заходов).
 */
export function ProInterestForm({ source, lang }: { source: string; lang: Lang }) {
  const [email, setEmail] = useState('')
  // ⚠️ `pending` — ТРЕТЬЕ значение `useActionState`, а не отдельный переход. Внешний
  // `useTransition` оставался false всё время запроса: колбэк был синхронным и лишь
  // ставил вызов в очередь, а свой переход React заводит внутри. Кнопка не блокировалась,
  // и человек не получал никакого отклика на нажатие.
  const [state, dispatch, pending] = useActionState<ProInterestResult | null, FormData>(
    (_prev, fd) => expressProInterest(source, fd),
    null,
  )

  if (state && 'ok' in state) {
    return (
      <p className="mt-3 flex items-center gap-2 text-body-sm text-ok">
        <Sparkles size={14} />
        {t(state.already ? 'pro.alreadyNoted' : 'pro.noted', lang)}
      </p>
    )
  }

  const send = () => {
    const fd = new FormData()
    fd.set('email', email)
    dispatch(fd)
  }

  return (
    <div className="mt-3">
      <p className="mb-2 text-body-sm text-muted">{t('pro.pitch', lang)}</p>
      {/* Колонка на мобиле: поле и кнопка в строку на 390px не помещаются. */}
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input
          // ⚠️ НЕ `type="email"`. Поле стоит ВНУТРИ формы создания списка, и нативная
          // проверка браузера распространяется на всю форму: недописанный адрес в этом
          // поле блокировал отправку САМОЙ ФОРМЫ — человек нажимал «Создать» и получал
          // подсказку у чужого поля. Отсутствие `name` от проверки не спасает.
          type="text"
          inputMode="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder={t('pro.emailPh', lang)}
          className="min-w-0 flex-1"
          disabled={pending}
          // Enter отправляет — привычка от формы сохраняется, хотя формы здесь нет.
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              send()
            }
          }}
        />
        <button
          type="button"
          className={buttonClass({ variant: 'primary', className: 'max-sm:w-full' })}
          disabled={pending || !email.trim()}
          onClick={send}
        >
          {t('pro.cta', lang)}
        </button>
      </div>
      {state && 'error' in state && (
        <p className="mt-2 text-body-sm text-danger">
          {t(state.error === 'bad-email' ? 'pro.errEmail' : 'pro.errTooOften', lang)}
        </p>
      )}
      {/* Ровно то, что делает это замером, а не обещанием. */}
      <p className="mt-2 text-caption text-muted">{t('pro.noBilling', lang)}</p>
    </div>
  )
}
