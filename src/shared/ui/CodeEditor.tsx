'use client'

import dynamic from 'next/dynamic'
import type { Lang } from '@/shared/i18n'

export type CodeEditorProps = {
  value: string
  onChange: (v: string) => void
  /** Язык подписей служебных кнопок (копирование, перенос строк). */
  lang?: Lang
  placeholder?: string
  ariaLabel?: string
  /** Предел высоты окна с прокруткой внутри. По умолчанию поле команды шага —
   *  оно короткое; целому файлу (правка списка как кода) нужно больше места. */
  maxHeightClass?: string
}

// CodeMirror грузим ЛЕНИВО (ssr:false) — тяжёлые пакеты не идут в основной бандл и
// на SSR. Пока грузится — моно-плейсхолдер с текущим значением (без «прыжка» пустоты).
const Inner = dynamic(() => import('./CodeEditorInner'), { ssr: false })

export function CodeEditor(props: CodeEditorProps) {
  return <Inner {...props} />
}
