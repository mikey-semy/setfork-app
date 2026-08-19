'use client'

import { useState } from 'react'
import { Check, Copy, X } from 'lucide-react'
import { IconButton } from './IconButton'
import { Tooltip } from './Tooltip'
import { iconSizeFor, type ControlSize } from './control'
import { t, type Lang } from '@/shared/i18n'

/**
 * Кнопка-иконка «скопировать»: aria-label обязателен по смыслу (иконка без
 * текста — Lighthouse button-name, линза 07).
 *
 * Язык передаётся ОДНИМ пропом `lang`, а не тремя подписями: у кнопки восемь
 * вызывающих, половина не передавала подписей вовсе — и любое новое состояние
 * (например, отказ) автоматически оказывалось англоязычным на русской странице.
 * Явные подписи по-прежнему перекрывают словарь — для мест со своей формулировкой.
 *
 * Отказ буфера НЕ проглатывается. В небезопасном контексте (http, своё
 * развёртывание) `navigator.clipboard` отсутствует, а `writeText` возвращает
 * промис — прежний `try/catch` вокруг несинхронного вызова отказ не ловил вовсе.
 * Молчаливая кнопка приводит к тому, что человек вставляет в терминал прошлое
 * содержимое буфера.
 *
 * ГЕОМЕТРИЯ — из примитива, а не своя. Кнопка была нарисована руками
 * (`grid size-8 … rounded-md … pointer-coarse:size-11`) и потому жила по правилу,
 * отменённому 13.08.2026: на сенсоре РОСЛА до 44px. Правило теперь другое — вид
 * один на все указатели, а тач-цель добирается невидимой зоной (`touch='hit'`
 * в buttonClass). Расхождение было видно вживую: строку команды в шаге списка
 * распирала именно выросшая кнопка. Узда линта её не поймала — она ищет `h-*`
 * рядом с `rounded-md`, а здесь высота приходила из `size-*`.
 */
export function CopyButton({
  text,
  lang = 'en',
  label,
  copiedLabel,
  failedLabel,
  size = 'md',
}: {
  text: string
  lang?: Lang
  label?: string
  copiedLabel?: string
  failedLabel?: string
  /** Ступень шкалы: `sm` — внутри поля или строки команды, где высоту уже задала рамка. */
  size?: ControlSize
}) {
  const [state, setState] = useState<'idle' | 'done' | 'failed'>('idle')
  const title =
    state === 'done' ? (copiedLabel ?? t('copied', lang)) : state === 'failed' ? (failedLabel ?? t('copyFailed', lang)) : (label ?? t('copy', lang))
  const icon = iconSizeFor(size)

  const onClick = async () => {
    try {
      if (!navigator.clipboard?.writeText) throw new Error('clipboard unavailable')
      await navigator.clipboard.writeText(text)
      setState('done')
    } catch {
      setState('failed')
    }
    setTimeout(() => setState('idle'), 1600)
  }

  return (
    <Tooltip label={title}>
      <IconButton variant="ghost" size={size} label={title} onClick={onClick} className="text-muted">
        {state === 'done' ? (
          <Check size={icon} className="text-ok" />
        ) : state === 'failed' ? (
          <X size={icon} className="text-danger" />
        ) : (
          <Copy size={icon} />
        )}
      </IconButton>
    </Tooltip>
  )
}
