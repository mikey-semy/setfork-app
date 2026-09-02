'use client'

import { useMemo } from 'react'
import { WrapText } from 'lucide-react'
import { t, type Lang } from '@/shared/i18n'
import { useCodeWrap } from '@/shared/lib/code-wrap'
import { cn } from '@/shared/lib/cn'
import { Tooltip } from './Tooltip'
import { buttonClass } from './button-style'
import CodeMirror, { EditorView, type Extension } from '@uiw/react-codemirror'
import { StreamLanguage } from '@codemirror/language'
import { javascript } from '@codemirror/lang-javascript'
import { python } from '@codemirror/lang-python'
import { sql } from '@codemirror/lang-sql'
import { yaml } from '@codemirror/lang-yaml'
import { shell } from '@codemirror/legacy-modes/mode/shell'
import { dockerFile } from '@codemirror/legacy-modes/mode/dockerfile'
import { useTheme } from 'next-themes'
import { TEXT } from './control'
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
  maxHeightClass = 'max-h-64',
  lang = 'en',
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  ariaLabel?: string
  maxHeightClass?: string
  /** Язык интерфейса для подписей — тем же пропом, что у кнопки копирования рядом. */
  lang?: Lang
}) {
  const { resolvedTheme } = useTheme()
  const id = detectLang(value)
  // Номера строк — как только в поле есть код. Раньше условие было `includes('\n')`,
  // но ОДНА длинная команда переносится (lineWrapping) и визуально занимает несколько
  // строк — номеров не было, хотя пользователь видит «больше одной строки».
  const hasCode = value.trim() !== ''
  // ⚠️ ПЕРЕНОС ВЫКЛЮЧЕН ПО УМОЛЧАНИЮ — как у всех, кто правит код: CodeMirror без
  // `lineWrapping` (наша же основа), VS Code с `editor.wordWrap: "off"`, редактор
  // файлов GitHub. Перенос рвёт выражение посередине, и структура кода рассыпается —
  // владелец увидел это и во врезке разбора, и здесь (02.09.2026). Выбор общий с
  // просмотром: одно решение читателя на весь продукт, не две настройки.
  const [wrap, toggleWrap] = useCodeWrap()
  const wrapLabel = t(wrap ? 'code.noWrap' : 'code.wrap', lang)
  const extensions = useMemo(
    () => (wrap ? [langExt(id), appTheme, EditorView.lineWrapping] : [langExt(id), appTheme]),
    [id, wrap],
  )

  return (
    <div className="relative" role="group" aria-label={ariaLabel}>
      {/* Язык и «копировать» — плотно в ПРАВОМ ВЕРХНЕМ УГЛУ и мельче текста кода:
          это служебная пара, она не должна спорить с содержимым поля. */}
      {value.trim() !== '' && (
        <span className="absolute right-1 top-1 z-10 inline-flex items-center gap-1">
          <span className={`pointer-events-none font-mono ${TEXT.caption} uppercase tracking-wide text-muted/80`}>
            {LANG_LABEL[id]}
          </span>
          {/* Тумблер переноса рядом с копированием — там же, где во врезке разбора. */}
          <Tooltip label={wrapLabel}>
            <button
              type="button"
              onClick={toggleWrap}
              aria-pressed={wrap}
              aria-label={wrapLabel}
              className={buttonClass({ variant: 'ghost', size: 'sm', className: cn('px-1.5', wrap && 'text-accent') })}
            >
              <WrapText size={14} />
            </button>
          </Tooltip>
          <CopyButton text={value} lang={lang} />
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
        className={`${maxHeightClass} min-h-10.5 overflow-auto rounded-md border border-border bg-surface-2 text-ink focus-within:border-border-strong`}
      />
    </div>
  )
}
