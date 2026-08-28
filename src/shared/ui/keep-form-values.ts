'use client'

import { useEffect, useRef } from 'react'

/**
 * СОХРАНИТЬ НАБРАННОЕ ПРИ ОТКАЗЕ ДЕЙСТВИЯ.
 *
 * `<form action={…}>` в React сбрасывается автоматически после отправки — это описано в
 * документации useActionState и относится ко всем НЕуправляемым полям. Управляемые
 * переживают отказ сами (их значение в состоянии), поэтому заметки релиза оставались, а
 * тег и заголовок обнулялись: замер 28.08.2026 показал ровно это, и на это же указало
 * авто-ревью #832.
 *
 * Приём: перед отправкой снимаем снимок формы, а после отказа возвращаем значения в те
 * поля, которые сбросились. Управляемые не трогаем — у них своё состояние, и запись в
 * DOM мимо React только рассинхронизировала бы его.
 *
 * Почему здесь, а не `defaultValue` из состояния: поля этих форм рисует СЕРВЕР (редактор
 * блоков, панель настроек, выбор версии), обёртка их не строит и подставить им значение
 * не может. Приём работает независимо от того, кто и где отрисовал поле.
 *
 * ⚠️ ГРАНИЦА: восстановление клиентское, поэтому БЕЗ JS набранное при отказе теряется,
 * как и раньше. Закрыть это можно только возвратом значений с сервера в `defaultValue`,
 * а подставить их некому — см. абзац выше. Отказы, доступные без JS, при этом редки:
 * пустое обязательное поле браузер не отправляет сам, остаются предел числа списков,
 * занятый адрес и занятый тег. Указано авто-ревью #832 и здесь названо, а не умолчано.
 *
 * `pending` — сигнал «действие завершилось». Зависеть от одного `refused` нельзя: после
 * первого отказа он остаётся `true`, и ВТОРОЙ отказ подряд эффект бы не разбудил — поля
 * так и остались бы пустыми (тоже авто-ревью #832).
 */
export function useKeepFormValues(refused: boolean, pending: boolean) {
  const formRef = useRef<HTMLFormElement>(null)
  const snapshot = useRef<Map<string, string | boolean> | null>(null)

  /** Снимок берём на СВОЁМ обработчике отправки — он идёт раньше, чем действие. */
  const onSubmit = () => {
    const form = formRef.current
    if (!form) return
    const values = new Map<string, string | boolean>()
    for (const el of Array.from(form.elements)) {
      const field = el as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
      if (!field.name || field.tagName === 'BUTTON') continue
      const isCheck = field instanceof HTMLInputElement && (field.type === 'checkbox' || field.type === 'radio')
      values.set(isCheck ? `${field.name}:${(field as HTMLInputElement).value}` : field.name, isCheck ? (field as HTMLInputElement).checked : field.value)
    }
    snapshot.current = values
  }

  useEffect(() => {
    const form = formRef.current
    const values = snapshot.current
    if (!refused || !form || !values) return
    for (const el of Array.from(form.elements)) {
      const field = el as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
      if (!field.name || field.tagName === 'BUTTON') continue
      const isCheck = field instanceof HTMLInputElement && (field.type === 'checkbox' || field.type === 'radio')
      const was = values.get(isCheck ? `${field.name}:${(field as HTMLInputElement).value}` : field.name)
      if (was === undefined) continue
      if (isCheck) (field as HTMLInputElement).checked = Boolean(was)
      // Пустое поле при непустом снимке = его сбросила форма. Непустое трогать нельзя:
      // это управляемое поле со своим состоянием, и запись мимо React его рассинхронизирует.
      else if (field.value === '' && typeof was === 'string' && was !== '') field.value = was
    }
    // Снимок держим и дальше: следующая отправка возьмёт новый, а до неё он нужен на
    // случай повторного отказа.
  }, [refused, pending])

  return { formRef, onSubmit }
}
