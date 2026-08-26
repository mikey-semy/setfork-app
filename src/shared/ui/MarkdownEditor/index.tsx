'use client'
import { type KeyboardEvent, useRef, useState } from 'react'
import { DEFAULT_LANG, isLang, t } from '@/shared/i18n'
import { Markdown } from '../Markdown'
import { MentionList } from '../MentionList'
import { useMention, type MentionUser } from '../use-mention'
import { useTextOps } from '../use-text-ops'
import { EditorToolbar } from './EditorToolbar'
import { IssueRefList } from './IssueRefList'
import { useEditorHistory } from './use-editor-history'
import { useIssueRef } from './use-issue-ref'
import { useUploads } from './use-uploads'

type Props = {
  name: string
  defaultValue?: string
  placeholder?: string
  rows?: number
  maxLength?: number
  autoFocus?: boolean
  /** Язык приходит и из слабо типизированных мест (`lang: string`) — сверяем охранником. */
  lang?: string
  className?: string
  /** Репо для #-reference (кросс-ссылки на issue): включает `#`-автодополнение. */
  refScope?: { owner: string; slug: string }
  /** Участники (автор/исполнители/комментаторы) — показываются в @mention сразу, первыми. */
  people?: MentionUser[]
  /** Колбэк значения — для контролируемого использования (напр. редактор списков,
   *  где текст сериализуется в общий JSON). Форма-режим (`name`) работает и без него. */
  onValueChange?: (value: string) => void
}

/**
 * Богатый markdown-редактор: тулбар, Write/Preview, эмодзи, @mention и #-ссылки на
 * задачи, картинки и вложения, Tab-отступ, undo/redo и горячие клавиши. Управляемая
 * `<textarea name>` — работает и в обычной форме, и как контролируемое поле.
 *
 * Здесь остались только поле и связь частей: правка текста — общая с BubbleTextEditor
 * (`useTextOps`), история — `use-editor-history`, загрузки — `use-uploads`, ссылки на
 * задачи — `use-issue-ref`, панель — `EditorToolbar`.
 */
export function MarkdownEditor({
  name,
  defaultValue = '',
  placeholder,
  rows = 6,
  maxLength,
  autoFocus,
  lang: rawLang,
  className,
  refScope,
  people = [],
  onValueChange,
}: Props) {
  const lang = isLang(rawLang) ? rawLang : DEFAULT_LANG
  const [value, setValue] = useState(defaultValue)
  const [tab, setTab] = useState<'write' | 'preview'>('write')
  const ref = useRef<HTMLTextAreaElement>(null)
  const imgInput = useRef<HTMLInputElement>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  // «Живое» значение: state обновится позже, а расчёты идут по текущему тексту.
  const live = useRef(defaultValue)

  // Единая точка изменения: state + колбэк наружу (контролируемый режим).
  const emit = (next: string) => {
    live.current = next
    setValue(next)
    onValueChange?.(next)
  }
  const putCaret = (start: number, end: number) =>
    requestAnimationFrame(() => {
      const el = ref.current
      if (!el) return
      el.focus()
      el.setSelectionRange(start, end)
    })

  const history = useEditorHistory(defaultValue, (restored) => {
    emit(restored)
    putCaret(restored.length, restored.length)
  })

  /** Программная правка (тулбар, эмодзи, вставка): в текст, в историю, каретку на место. */
  const apply = (next: string, selStart: number, selEnd: number) => {
    emit(next)
    history.record(next, false)
    putCaret(selStart, selEnd)
  }

  const ops = useTextOps({ ref, read: () => live.current, apply, placeholder: t('editor.textPlaceholder', lang) })
  const mention = useMention({ value, ref, apply: (next, s, e) => apply(next, s, e), people })
  const issues = useIssueRef({
    ref,
    scope: refScope,
    apply: (start, end, text) => {
      const caret = start + text.length
      apply(live.current.slice(0, start) + text + live.current.slice(end), caret, caret)
    },
  })
  const uploads = useUploads({
    lang,
    read: () => live.current,
    replace: (next) => {
      emit(next)
      history.record(next, false)
    },
    insert: ops.insertAt,
  })

  function onChange(next: string) {
    emit(next)
    history.record(next, true)
    mention.onText(next)
    issues.onText(next, ref.current?.selectionStart ?? next.length)
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    // Порядок важен: пока открыт список подсказок, стрелки и Enter принадлежат ему.
    if (mention.onKeyDown(e)) return
    if (issues.onKeyDown(e)) return
    if (undoRedo(e)) return
    if (ops.hotkey(e)) return
    ops.indent(e)
  }

  function undoRedo(e: KeyboardEvent<HTMLTextAreaElement>): boolean {
    if (!(e.metaKey || e.ctrlKey)) return false
    const k = e.key.toLowerCase()
    if (k === 'z' && !e.shiftKey) history.undo()
    else if (k === 'y' || (k === 'z' && e.shiftKey)) history.redo()
    else return false
    e.preventDefault()
    return true
  }

  return (
    <div className={`overflow-hidden rounded-md border border-border bg-surface ${className ?? ''}`}>
      <EditorToolbar lang={lang} tab={tab} onTab={setTab} ops={ops} onPickImage={() => imgInput.current?.click()} onPickFile={() => fileInput.current?.click()} />

      <input ref={imgInput} type="file" accept="image/*" multiple className="hidden" onChange={(e) => { uploads.fromEvent(e.target.files, e); e.target.value = '' }} />
      <input ref={fileInput} type="file" multiple className="hidden" onChange={(e) => { uploads.fromEvent(e.target.files, e); e.target.value = '' }} />

      <div className={`relative ${tab === 'preview' ? 'hidden' : ''}`}>
        <textarea
          ref={ref}
          name={name}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
          onBlur={() => setTimeout(() => { mention.close(); issues.close() }, 150)}
          aria-label={placeholder || t('editor.markdownAria', lang)}
          placeholder={placeholder}
          rows={rows}
          maxLength={maxLength}
          autoFocus={autoFocus}
          onPaste={(e) => uploads.fromEvent(e.clipboardData.files, e)}
          onDrop={(e) => uploads.fromEvent(e.dataTransfer.files, e)}
          className="w-full resize-y bg-surface px-3 py-2.5 text-body-lg text-ink outline-hidden placeholder:text-muted"
        />

        {mention.mention && mention.users.length > 0 && (
          <MentionList users={mention.users} index={mention.index} onHover={mention.setIndex} onPick={mention.pick} at={mention.anchor} />
        )}
        <IssueRefList hits={issues.hits} index={issues.index} anchor={issues.anchor} onHover={issues.setIndex} onPick={issues.pick} />
      </div>

      {tab === 'preview' && (
        <div className="min-h-20 px-3 py-2.5">
          {value.trim() ? <Markdown>{value}</Markdown> : <p className="text-body italic text-muted">{t('editor.nothingToPreview', lang)}</p>}
        </div>
      )}

      <div className="flex items-center gap-2 border-t border-border bg-surface-2 px-3 py-1.5 text-caption text-muted">
        <span>{t('editor.markdownSupported', lang)}</span>
        <span className="text-border">·</span>
        <button type="button" onClick={() => fileInput.current?.click()} className="hover:text-ink">
          {t('editor.pasteDropAttach', lang)}
        </button>
        {uploads.busy > 0 && <span className="text-accent">· {t('editor.uploading', lang)}</span>}
      </div>
    </div>
  )
}
