'use client'

import type { DragEvent, ReactNode } from 'react'
import { ChevronDown, ChevronsDown, ChevronsUp, ChevronUp, GripVertical, Heading, Trash2 } from 'lucide-react'
import { BubbleTextEditor } from '@/shared/ui/BubbleTextEditor'
import { Tooltip } from '@/shared/ui/Tooltip'
import { t, type Lang } from '@/shared/i18n'
import type { EditorItem } from '../editor'
import { BLOCK_ICON, blockLabel } from './BlockInserter'
import { FileBlockBody, ImageBlockBody, TextBlockBody, VideoBlockBody } from './MediaBlocks'
import { PollBlockBody } from './PollBlockBody'
import { ProductBlockBody } from './ProductBlockBody'
import { QuizBlockBody } from './QuizBlockBody'
import { StepBlockBody } from './StepBlockBody'
import type { DropKind } from './FileDrop'

export type CardDrag = {
  dragging: boolean
  over: boolean
  onDragStart: () => void
  onDragEnd: () => void
  onDragOver: (e: DragEvent) => void
  onDrop: (e: DragEvent) => void
}

type BlockCardProps = {
  item: EditorItem
  index: number
  /** Стабильный id строки — по нему FLIP-анимация узнаёт карточку на новом месте. */
  uid: string
  /** Номер шага в нумерованном списке; null — маркер вместо числа. */
  stepNumber: number | null
  isFirst: boolean
  isLast: boolean
  lang: Lang
  drag: CardDrag
  onPatch: (p: Partial<EditorItem>) => void
  onMove: (dir: -1 | 1) => void
  onMoveToEdge: (edge: 'top' | 'bottom') => void
  onRemove: () => void
  isUploading: (kind: DropKind) => boolean
  onUpload: (kind: DropKind, file: File) => void
  /** Инсертер следующего блока — стоит внутри карточки, под её содержимым. */
  insertAfter?: ReactNode
}

/** Тело карточки — по типу блока. Каждый вид живёт своим файлом; здесь только выбор. */
function BlockBody({
  item,
  index,
  onPatch,
  lang,
  isUploading,
  onUpload,
}: {
  item: EditorItem
  index: number
  onPatch: (p: Partial<EditorItem>) => void
  lang: Lang
  isUploading: (kind: DropKind) => boolean
  onUpload: (kind: DropKind, file: File) => void
}) {
  const media = {
    item,
    onPatch,
    lang,
    uploading: isUploading(item.type === 'video' ? 'video' : item.type === 'file' ? 'file' : 'image'),
    onFile: (f: File) => onUpload(item.type === 'video' ? 'video' : item.type === 'file' ? 'file' : 'image', f),
  }
  switch (item.type) {
    case 'step':
      return <StepBlockBody item={item} index={index} onPatch={onPatch} lang={lang} uploading={media.uploading} onFile={media.onFile} />
    case 'text':
      return <TextBlockBody value={item.text} onChange={(text) => onPatch({ text })} lang={lang} />
    case 'image':
      return <ImageBlockBody {...media} />
    case 'video':
      return <VideoBlockBody {...media} />
    case 'file':
      return <FileBlockBody {...media} />
    case 'poll':
      return <PollBlockBody poll={item.poll} onChange={(poll) => onPatch({ poll })} lang={lang} />
    case 'quiz':
      return <QuizBlockBody quiz={item.quiz} onChange={(quiz) => onPatch({ quiz })} lang={lang} />
    case 'product':
      return <ProductBlockBody products={item.products} caption={item.caption} onProducts={(products) => onPatch({ products })} onCaption={(caption) => onPatch({ caption })} lang={lang} />
  }
}

/**
 * Карточка блока: обвязка, одинаковая у всех восьми видов, — ручка перетаскивания,
 * номер или подпись типа, кнопки порядка и удаления, поле «урок/секция». Что внутри,
 * решает тип блока.
 *
 * Стрелки не вспомогательные, а основной путь: перетаскивание построено на HTML5
 * drag-and-drop, который на тач-экранах работает не везде.
 */
export function BlockCard({ item, index, uid, stepNumber, isFirst, isLast, lang, drag, onPatch, onMove, onMoveToEdge, onRemove, isUploading, onUpload, insertAfter }: BlockCardProps) {
  const TypeIcon = BLOCK_ICON[item.type]
  return (
    <div
      data-i={index}
      data-uid={uid}
      onDragOver={drag.onDragOver}
      onDrop={drag.onDrop}
      className={`rounded-lg border bg-surface p-4 transition-colors ${drag.over ? 'border-accent' : 'border-border'} ${drag.dragging ? 'opacity-50' : ''}`}
    >
      <div className="mb-2.5 flex items-center gap-2">
        <Tooltip label={t('editor.dragToReorder', lang)}>
          <span draggable onDragStart={drag.onDragStart} onDragEnd={drag.onDragEnd} className="cursor-grab rounded-md p-0.5 text-muted hover:text-ink active:cursor-grabbing">
            <GripVertical size={15} />
          </span>
        </Tooltip>
        {item.type === 'step' ? (
          <span className="font-mono text-[0.78125rem] text-muted">{stepNumber === null ? '•' : t('editor.itemN', lang).replace('{n}', String(stepNumber))}</span>
        ) : (
          <span className="inline-flex items-center gap-1 font-mono text-[0.78125rem] text-muted">
            <TypeIcon size={13} />
            {blockLabel(item.type, lang)}
          </span>
        )}
        <div className="ml-auto flex items-center gap-1">
          <Tooltip label={t('editor.moveTop', lang)}>
            <button type="button" onClick={() => onMoveToEdge('top')} disabled={isFirst} className="rounded-md p-1 text-muted hover:text-ink disabled:opacity-30 disabled:hover:text-muted">
              <ChevronsUp size={15} />
            </button>
          </Tooltip>
          <Tooltip label={t('editor.moveUp', lang)}>
            <button type="button" onClick={() => onMove(-1)} disabled={isFirst} className="rounded-md p-1 text-muted hover:text-ink disabled:opacity-30 disabled:hover:text-muted">
              <ChevronUp size={15} />
            </button>
          </Tooltip>
          <Tooltip label={t('editor.moveDown', lang)}>
            <button type="button" onClick={() => onMove(1)} disabled={isLast} className="rounded-md p-1 text-muted hover:text-ink disabled:opacity-30 disabled:hover:text-muted">
              <ChevronDown size={15} />
            </button>
          </Tooltip>
          <Tooltip label={t('editor.moveBottom', lang)}>
            <button type="button" onClick={() => onMoveToEdge('bottom')} disabled={isLast} className="rounded-md p-1 text-muted hover:text-ink disabled:opacity-30 disabled:hover:text-muted">
              <ChevronsDown size={15} />
            </button>
          </Tooltip>
          <Tooltip label={t('editor.remove', lang)}>
            <button type="button" onClick={onRemove} className="rounded-md p-1 text-muted hover:text-danger">
              <Trash2 size={15} />
            </button>
          </Tooltip>
        </div>
      </div>

      {/* Урок/секция есть у ЛЮБОГО блока: заданный заголовок начинает новую группу
          (урок курса) и объединяет блоки ниже до следующего такого заголовка. */}
      <div className={`mb-2 flex items-center gap-1.5 ${item.section.trim() ? 'text-accent' : 'text-muted'}`}>
        <Heading size={13} className="shrink-0" />
        <BubbleTextEditor
          value={item.section}
          onChange={(section) => onPatch({ section })}
          singleLine
          bare
          className="flex-1"
          textareaClassName="text-[0.78125rem] font-semibold placeholder:font-normal placeholder:text-muted"
          lang={lang}
          ariaLabel={t('editor.sectionOfBlockN', lang).replace('{n}', String(index + 1))}
          placeholder={t('editor.sectionPh', lang)}
        />
      </div>

      <BlockBody item={item} index={index} onPatch={onPatch} lang={lang} isUploading={isUploading} onUpload={onUpload} />
      {insertAfter}
    </div>
  )
}
