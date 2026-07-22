'use client'

import { useMemo } from 'react'
import CodeMirror, { EditorView, type Extension } from '@uiw/react-codemirror'
import { StreamLanguage } from '@codemirror/language'
import { javascript } from '@codemirror/lang-javascript'
import { python } from '@codemirror/lang-python'
import { sql } from '@codemirror/lang-sql'
import { yaml } from '@codemirror/lang-yaml'
import { shell } from '@codemirror/legacy-modes/mode/shell'
import { dockerFile } from '@codemirror/legacy-modes/mode/dockerfile'
import { useTheme } from 'next-themes'
import { detectLang, LANG_LABEL, type CodeLang } from './detect-lang'
import { CopyButton } from './CopyButton'

// Расширение подсветки по определённому языку. Ленивые пакеты уже импортированы —
// этот файл сам грузится динамически (см. CodeEditor.tsx), в основной бандл не идёт.
function langExt(id: CodeLang): Extension {
  switch (id) {
    case 'javascript':
      return javascript({ typescript: true })
    case 'json':
      return javascript() // JSON — подмножество JS, подсветки достаточно (без отд. пакета)
    case 'python':
      return python()
    case 'sql':
      return sql()
    case 'yaml':
      return yaml()
    case 'dockerfile':
      return StreamLanguage.define(dockerFile)
    default:
      return StreamLanguage.define(shell)
  }
}

// Прозрачный фон + моношрифт приложения: CodeMirror вписывается в бордер-контейнер
// (цвет фона даёт контейнер, а не тема CM).
const appTheme = EditorView.theme({
  '&': { backgroundColor: 'transparent', fontSize: '13px' },
  '&.cm-focused': { outline: 'none' },
  '.cm-content': { fontFamily: 'var(--font-mono, ui-monospace, monospace)', padding: '8px 0' },
  '.cm-gutters': { backgroundColor: 'transparent', border: 'none' },
  '.cm-lineNumbers .cm-gutterElement': { padding: '0 8px 0 10px', minWidth: '20px' },
})

export default function CodeEditorInner({
  value,
  onChange,
  placeholder,
  ariaLabel,
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  ariaLabel?: string
}) {
  const { resolvedTheme } = useTheme()
  const id = detectLang(value)
  // Номера строк — как только в поле есть код. Раньше условие было `includes('\n')`,
  // но ОДНА длинная команда переносится (lineWrapping) и визуально занимает несколько
  // строк — номеров не было, хотя пользователь видит «больше одной строки».
  const hasCode = value.trim() !== ''
  const extensions = useMemo(() => [langExt(id), appTheme, EditorView.lineWrapping], [id])

  return (
    <div className="relative" role="group" aria-label={ariaLabel}>
      {/* Правый верхний угол: язык + копировать (фидбек владельца). */}
      {value.trim() !== '' && (
        <span className="absolute right-2 top-1.5 z-10 inline-flex items-center gap-1.5">
          <span className="pointer-events-none rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide text-muted">
            {LANG_LABEL[id]}
          </span>
          <CopyButton text={value} />
        </span>
      )}
      <CodeMirror
        value={value}
        onChange={onChange}
        theme={resolvedTheme === 'dark' ? 'dark' : 'light'}
        extensions={extensions}
        placeholder={placeholder}
        basicSetup={{
          lineNumbers: hasCode,
          foldGutter: false,
          highlightActiveLine: false,
          highlightActiveLineGutter: false,
          autocompletion: false,
          searchKeymap: false,
          drawSelection: true,
        }}
        className="max-h-64 min-h-[42px] overflow-auto rounded-md border border-border bg-surface-2 text-ink focus-within:border-border-strong"
      />
    </div>
  )
}
