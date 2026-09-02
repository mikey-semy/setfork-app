'use client'
import { useCallback, useEffect, useState } from 'react'

/**
 * ПЕРЕНОС СТРОК КОДА — ОДИН ВЫБОР НА ПРОДУКТ.
 *
 * Читатель решает это один раз: и во врезке разбора, и в редакторе списка. Держать две
 * настройки нельзя — человек переключал бы вид дважды и не понимал, почему в одном
 * месте перенос есть, а в другом нет.
 *
 * ⚠️ ВЫКЛЮЧЕН ПО УМОЛЧАНИЮ, потому что так у всех, кто правит код: CodeMirror без
 * `lineWrapping` (наша же основа), VS Code с `editor.wordWrap: "off"`, редактор файлов
 * GitHub. Причина общая: перенос рвёт выражение посередине, и структура кода — то,
 * ради чего его и читают, — рассыпается. Владелец увидел это и во врезке (02.09.2026),
 * и в редакторе.
 *
 * Хранится в localStorage, а не в куке: сервер об этом знать не должен — перенос
 * ничего не меняет в разметке, которую он отдаёт, только в поведении на клиенте.
 */
export const CODE_WRAP_KEY = 'sf:code-wrap'
/** Событие для соседних блоков на той же странице: их у разбора десяток. */
const CHANGED = 'sf:code-wrap-changed'

export function readCodeWrap(): boolean {
  try {
    return window.localStorage.getItem(CODE_WRAP_KEY) === '1'
  } catch {
    return false
  }
}

/**
 * Значение и переключатель. Первый кадр всегда «без переноса» — тот же, что у сервера:
 * читать localStorage во время рендера нельзя, разметка разошлась бы с серверной.
 */
export function useCodeWrap(): [boolean, () => void] {
  const [wrap, setWrap] = useState(false)

  useEffect(() => {
    setWrap(readCodeWrap())
    const sync = () => setWrap(readCodeWrap())
    window.addEventListener(CHANGED, sync)
    // `storage` приходит из ДРУГОЙ вкладки — та же настройка, тот же человек.
    window.addEventListener('storage', sync)
    return () => {
      window.removeEventListener(CHANGED, sync)
      window.removeEventListener('storage', sync)
    }
  }, [])

  const toggle = useCallback(() => {
    const next = !readCodeWrap()
    try {
      window.localStorage.setItem(CODE_WRAP_KEY, next ? '1' : '0')
    } catch {
      // Не запомнилось — но в этом просмотре всё равно переключится.
    }
    setWrap(next)
    window.dispatchEvent(new Event(CHANGED))
  }, [])

  return [wrap, toggle]
}
