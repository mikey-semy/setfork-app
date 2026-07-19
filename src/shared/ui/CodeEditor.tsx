'use client'

import dynamic from 'next/dynamic'

export type CodeEditorProps = {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  ariaLabel?: string
}

// CodeMirror грузим ЛЕНИВО (ssr:false) — тяжёлые пакеты не идут в основной бандл и
// на SSR. Пока грузится — моно-плейсхолдер с текущим значением (без «прыжка» пустоты).
const Inner = dynamic(() => import('./CodeEditorInner'), { ssr: false })

export function CodeEditor(props: CodeEditorProps) {
  return <Inner {...props} />
}
