'use client'

import { useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { caretCoords } from './caret-coords'
import { BubbleToolbar } from './BubbleToolbar'
import { markdownToolbarGroups } from './markdown-toolbar'
import { MentionList } from './MentionList'
import { TEXT } from './control'
import { useMention } from './use-mention'
import { useTextOps } from './use-text-ops'
import { t } from '@/shared/i18n'

// Редактор текста со ВСПЛЫВАЮЩЕЙ (bubble) панелью: появляется, пока работаешь с
// текстом (фокус/выделение), плавает у курсора и НЕ перекрывает текст. Полный набор
// форматирования + список + эмодзи + @упоминания. БЕЗ картинок/файлов — для них
// отдельные блоки. Управляемый (value/onChange), рендерится Markdown'ом.
//
// Здесь остались только текст и каретка: панель инструментов живёт в
// BubbleToolbar, упоминания — в useMention/MentionList. Раньше всё это лежало в
// одном компоненте, и правка панели неизбежно ехала рядом с поиском людей.
export function BubbleTextEditor({
  value,
  onChange,
  placeholder,
  rows = 3,
  lang = 'en',
  ariaLabel,
  singleLine = false,
  mono = false,
  bare = false,
  className,
  textareaClassName,
  trailing,
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  rows?: number
  lang?: 'ru' | 'en'
  ariaLabel?: string
  singleLine?: boolean // одно-строчное поле (заголовок/команда/…) — Enter не переносит
  mono?: boolean // моноширинный (для команды)
  bare?: boolean // без рамки/фона (для инлайн-заголовка секции)
  className?: string // для обёртки (напр. flex-1 в строке)
  textareaClassName?: string // доп. классы поля (напр. font-semibold у секции)
  trailing?: ReactNode // кнопка/иконка внутри поля справа (напр. авто-генерация)
}) {
  const ref = useRef<HTMLTextAreaElement>(null)
  // Где стоит каретка; куда встанет панель — решает она сама, по своей высоте.
  const [caret, setCaret] = useState<{ top: number; bottom: number; left: number } | null>(null)
  // Последнее выделение: пикер эмодзи забирает фокус, и вставлять надо туда, где
  // человек стоял до его открытия.
  const savedSel = useRef<[number, number]>([0, 0])
  // Пикер эмодзи и меню «⋯» живут в портале: фокус уходит из поля, но панель
  // закрывать нельзя — иначе выбранный смайлик вставлять уже некуда.
  const overlayOpen = useRef(false)

  function apply(next: string, selStart: number, selEnd: number) {
    onChange(next)
    requestAnimationFrame(() => {
      const el = ref.current
      if (!el) return
      el.focus()
      el.setSelectionRange(selStart, selEnd)
      refresh()
    })
  }

  const mention = useMention({ value, ref, apply })

  // Позиция панели у текущего курсора/выделения (флип: над строкой либо под ней).
  function refresh() {
    const el = ref.current
    if (!el) return
    savedSel.current = [el.selectionStart, el.selectionEnd]
    if (mention.mention) {
      setCaret(null)
      return
    } // при активном @-меню панель прячем
    const start = caretCoords(el, el.selectionStart)
    const end = caretCoords(el, el.selectionEnd)
    setCaret({
      top: start.top - el.scrollTop,
      bottom: end.top - el.scrollTop + end.height,
      left: Math.max(4, Math.min(start.left, el.clientWidth - 300)),
    })
  }

  // Правка текста — общая с MarkdownEditor механика (use-text-ops): раньше surround и
  // linePrefix были здесь скопированы строка в строку.
  const ops = useTextOps({ ref, read: () => value, apply, placeholder: t('editor.textPlaceholder', lang) })

  function onChangeText(v: string) {
    onChange(v)
    if (mention.onText(v)) setCaret(null)
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (mention.onKeyDown(e)) return
    if (singleLine && e.key === 'Enter') {
      e.preventDefault()
      return
    } // одно-строчное поле
    ops.hotkey(e)
  }

  // Все инструменты одним рядом: что не влезло — уходит в «⋯». Порядок групп
  // сохраняем, он от частого к редкому.
  const tools = markdownToolbarGroups(ops, lang).flat()

  return (
    <div className={`relative ${className ?? ''}`}>
      <textarea
        ref={ref}
        value={value}
        aria-label={ariaLabel}
        placeholder={placeholder}
        rows={singleLine ? 1 : rows}
        onChange={(e) => onChangeText(e.target.value)}
        onFocus={refresh}
        onClick={refresh}
        onSelect={refresh}
        onKeyUp={refresh}
        onScroll={refresh}
        onKeyDown={onKeyDown}
        onBlur={() =>
          setTimeout(() => {
            if (!overlayOpen.current) {
              setCaret(null)
              mention.close()
            }
          }, 150)
        }
        // `block` обязателен: textarea по умолчанию inline-block, и под базовой
        // линией остаётся зазор — обёртка становится на 7px выше поля, а иконка
        // рядом (например «H» у строки урока) центрируется по обёртке и уезжает
        // относительно текста. Замер 09.08.2026: расхождение осей ровно 4px.
        className={`block w-full ${TEXT.body} leading-relaxed text-ink outline-hidden ${
          bare ? 'resize-none overflow-hidden bg-transparent' : 'rounded-md border border-border bg-surface-2 px-3 py-2 focus:border-border-strong'
        } ${singleLine && !bare ? 'resize-none overflow-hidden' : bare ? '' : 'min-h-18 resize-y'} ${trailing ? 'pr-9' : ''} ${mono ? `font-mono ${TEXT.bodySm}` : ''} ${textareaClassName ?? ''}`}
      />
      {trailing && <div className="absolute right-1.5 top-1.5">{trailing}</div>}

      {caret && !mention.mention && (
        <BubbleToolbar
          tools={tools}
          caret={caret}
          lang={lang}
          onMention={() => ops.insertAtRange('@', savedSel.current[0], savedSel.current[1])}
          onEmoji={(native) => ops.insertAtRange(native, savedSel.current[0], savedSel.current[1])}
          onOverlay={(open) => {
            overlayOpen.current = open
          }}
        />
      )}

      {mention.mention && mention.users.length > 0 && (
        <MentionList users={mention.users} index={mention.index} onHover={mention.setIndex} onPick={mention.pick} at={mention.anchor} />
      )}
    </div>
  )
}
