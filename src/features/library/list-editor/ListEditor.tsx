'use client'

import { useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { t, type Lang } from '@/shared/i18n'
import { toProposedItems, type EditorItem } from '../editor'
import { SuggestionResult } from '../SuggestionResult'
import { BlockCard } from './BlockCard'
import { BlockInserter } from './BlockInserter'
import { CanonPanel } from './CanonPanel'
import { EditorToolbar } from './EditorToolbar'
import { commandFor, isFieldTarget } from './hotkeys'
import { KeyboardDock } from './KeyboardDock'
import { BlockChatButton, BlockChatHost } from './BlockChat'
import { useBlockDrag } from './use-block-drag'
import { useBlockList } from './use-block-list'
import { useBlockUploads } from './use-block-uploads'
import { useFlipReorder } from './use-flip-reorder'

/**
 * Редактор состава списка: собирает воедино состояние (useBlockList), загрузки
 * (useBlockUploads), анимацию перестановки (useFlipReorder) и карточки блоков.
 * Сам ничего не хранит, кроме предпросмотра и того, что тащат указателем.
 *
 * Состав уходит на сервер скрытым полем формы — редактор не знает, кто его submit'ит
 * (новый список, правка версии или предложение).
 */
export function ListEditor({
  name = 'items',
  initialItems,
  lang,
  aiRefine,
  ordered = true,
  canonOf,
  headerField,
  headerRight,
}: {
  name?: string
  initialItems: EditorItem[]
  lang: Lang
  /** Контекст списка для чата правки блока: без него модель правит пункт вслепую. */
  aiRefine?: { title: string; desc: string; tags: string[] }
  /** Упорядоченный список — нумерация; иначе набор (маркеры). */
  ordered?: boolean
  /** Список, у которого есть канон (Ф4). У НЕсозданного списка его нет — ядру
   *  нечего показывать, поэтому режим «код» там не предлагается вовсе. */
  canonOf?: string
  /** Поле названия списка. Идёт ПОД действиями редактора и во всю ширину: в одном
   *  ряду с кнопками оно сжималось до 110px, и ввести название было нельзя. */
  headerField?: ReactNode
  /** Кнопка свойств списка — справа ОТ ПОЛЯ, в одном ряду с ним (решение владельца
   *  09.08): она про сам список, а не про правку блоков. */
  headerRight?: ReactNode
}) {
  const list = useBlockList(initialItems)
  const uploads = useBlockUploads(list.patchByUid)
  const listRef = useFlipReorder(list.uids)
  // ПРЕДПРОСМОТР рядом с правкой: до него единственным способом увидеть результат
  // было сохранить версию (жалоба владельца 04.08.2026). Показываем тем же
  // рендером, что и предложения правок, — вторая копия разъехалась бы с первой.
  const [preview, setPreview] = useState(false)
  // ПРАВКА КАК КОДА (Ф4): тот же состав каноническим list.json. Разобранный текст
  // возвращается блоками, а не сохраняется отдельным путём — сохранение одно.
  const [code, setCode] = useState(false)
  // Какой блок правят разговором — по стабильному id, а не по номеру: пока чат
  // открыт, список живёт (блок выше могли удалить), и номер начал бы указывать на
  // соседа. ОДНО окно на редактор: своё состояние у каждой карточки давало два чата
  // внахлёст, стоило открыть второй.
  const [chatUid, setChatUid] = useState<string | null>(null)
  const drag = useBlockDrag(list.reorder, listRef)
  // Границы редактора: по ним панель понимает, что клавиатуру открыли ЗДЕСЬ, а не в
  // соседнем поле формы (название списка, теги).
  const editorRef = useRef<HTMLDivElement>(null)

  // Клавиатура редактора: что означает нажатие — чистая функция с тестами, здесь
  // только исполнение команды. Номер блока берём у карточки под фокусом.
  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const el = e.target as HTMLElement
    const cmd = commandFor({
      key: e.key,
      mod: e.ctrlKey || e.metaKey,
      shift: e.shiftKey,
      alt: e.altKey,
      inField: isFieldTarget(el),
    })
    if (!cmd) return
    if (cmd.kind === 'move') {
      const card = el.closest('[data-i]') as HTMLElement | null
      if (!card) return
      e.preventDefault()
      list.move(Number(card.dataset.i), cmd.dir)
      return
    }
    e.preventDefault()
    if (cmd.kind === 'redo') list.redo()
    else list.undo()
  }

  const stepNumberAt = (i: number) => (ordered ? list.items.slice(0, i).filter((x) => x.type === 'step').length + 1 : null)

  return (
    <div ref={editorRef} className="flex flex-col gap-3" onKeyDown={onKeyDown}>
      <input type="hidden" name={name} value={JSON.stringify(list.items)} />

      {/* ОДИН ряд на всё: слева название списка, справа — действия редактора и
          свойства. Пока правят текст на телефоне, отмена и повтор переезжают к
          клавиатуре: в верху формы на длинном списке до них не дотянуться. */}
      {/* Действия редактора — в ПРАВОМ ВЕРХНЕМ УГЛУ, отдельной строкой над полем:
          там их место у всех служебных действий приложения. Подписи у строки нет —
          поле само себя объясняет плейсхолдером. */}
      <div className="flex items-center justify-end gap-1">
        <KeyboardDock scopeRef={editorRef}>
          <EditorToolbar
          canUndo={list.canUndo}
          canRedo={list.canRedo}
          onUndo={list.undo}
          onRedo={list.redo}
          preview={preview}
          onTogglePreview={() => setPreview((v) => !v)}
          code={code}
          onToggleCode={canonOf ? () => setCode((v) => !v) : undefined}
            lang={lang}
          />
        </KeyboardDock>
      </div>
      {/* Поле названия и свойства списка — один ряд: свойства про САМ список, и
          стоять им рядом с его названием. */}
      {(headerField || headerRight) && (
        <div className="flex items-center gap-2">
          <div className="min-w-0 flex-1">{headerField}</div>
          {headerRight}
        </div>
      )}

      {code && canonOf && (
        <CanonPanel
          // key по составу НЕ ставим: текст берётся один раз при открытии, иначе
          // набранное затиралось бы на каждое изменение блоков.
          templateId={canonOf}
          itemsJson={JSON.stringify(list.items)}
          onApply={(items) => {
            list.replaceAll(items)
            setCode(false)
          }}
          lang={lang}
        />
      )}

      {preview && (
        // Состав, приведённый к доменной форме, — ровно то, что уедет в версию.
        // Черновые пункты без заголовка сюда не попадают, как и при сохранении.
        <div className="rounded-lg border border-dashed border-border p-3">
          <div className="mb-2 text-[0.78125rem] text-muted">{t('previewHint', lang)}</div>
          <SuggestionResult items={toProposedItems(list.items, lang)} lang={lang} ordered={ordered} />
        </div>
      )}

      {/* Блоки прячем, но НЕ размонтируем: состав уезжает на сервер скрытым полем
          формы, и снятое дерево унесло бы с собой позиции загрузок и фокус. */}
      <div ref={listRef} className={`flex flex-col gap-3 ${preview || code ? 'hidden' : ''}`}>
        {/* Инсертер НАД первым блоком: без него «добавить сверху» стоило двух
            действий — добавить в конец и гнать блок наверх стрелками. */}
        {list.items.length > 0 && (
          <div className="flex justify-center">
            <BlockInserter onInsert={(type) => list.insertAt(0, type)} repeatType={list.items[0]?.type ?? 'step'} lang={lang} />
          </div>
        )}
        {list.items.map((item, i) => (
          <BlockCard
            key={list.uids[i]}
            item={item}
            index={i}
            uid={list.uids[i]}
            stepNumber={stepNumberAt(i)}
            isFirst={i === 0}
            isLast={i === list.items.length - 1}
            lang={lang}
            drag={{ dragging: drag.draggingFrom === i, line: drag.lineAt(i), handle: drag.handleProps(i) }}
            onPatch={(p) => list.patch(i, p)}
            onMove={(dir) => list.move(i, dir)}
            onMoveToEdge={(edge) => list.moveToEdge(i, edge)}
            onRemove={() => list.removeAt(i)}
            onInsertBelow={() => list.insertAt(i + 1, item.type)}
            onRetype={(type) => list.retype(i, type)}
            // Чат правки — только у шага: у опроса и картинки текстовых полей,
            // которые он правит, попросту нет.
            chat={aiRefine && item.type === 'step' ? <BlockChatButton onOpen={() => setChatUid(list.uids[i])} active={chatUid === list.uids[i]} lang={lang} /> : undefined}
            isUploading={(kind) => uploads.isBusy(list.uids[i], kind)}
            onUpload={(kind, file) => void uploads.upload(list.uids[i], kind, file)}
            // Инсертер после ПОСЛЕДНЕГО блока не рисуем: конец списка покрывает
            // главный инсертер ниже. «Повторить» = тип блока, под которым он стоит.
            insertAfter={i < list.items.length - 1 ? <BlockInserter onInsert={(type) => list.insertAt(i + 1, type)} repeatType={item.type} lang={lang} between /> : undefined}
          />
        ))}
      </div>

      {/* Чат правки блока — один на редактор, поверх страницы. */}
      {aiRefine &&
        (() => {
          const at = chatUid ? list.uids.indexOf(chatUid) : -1
          if (at < 0) return null
          return (
            <BlockChatHost
              // key по id блока: сменили блок — начинается новый разговор, а не
              // продолжается чужой.
              key={chatUid}
              item={list.items[at]}
              context={aiRefine}
              onApply={(patch) => list.patchByUid(chatUid!, patch)}
              onClose={() => setChatUid(null)}
              lang={lang}
            />
          )
        })()}

      {/* Главный инсертер — добавить блок в конец списка. */}
      <div className={`flex justify-center pt-1 ${preview || code ? 'hidden' : ''}`}>
        <BlockInserter onInsert={(type) => list.insertAt(list.items.length, type)} repeatType={list.items[list.items.length - 1]?.type ?? 'step'} lang={lang} />
      </div>
    </div>
  )
}
