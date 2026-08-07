'use client'

import type { PointerEvent, ReactNode } from 'react'
import { ChevronDown, ChevronsDown, ChevronsUp, ChevronUp, GripVertical, Heading, MoreHorizontal, Trash2 } from 'lucide-react'
import { BubbleTextEditor } from '@/shared/ui/BubbleTextEditor'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/shared/ui/dropdown-menu'
import { iconSizeFor } from '@/shared/ui/control'
import { IconButton } from '@/shared/ui/IconButton'
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
  /** У какой кромки показать линию места вставки; null — указатель целится не сюда. */
  line: 'before' | 'after' | null
  /** Обработчики ручки: цель переноса считает хук по геометрии, карточке знать её незачем. */
  handle: {
    onPointerDown: (e: PointerEvent) => void
    onPointerMove: (e: PointerEvent) => void
    onPointerUp: () => void
    onPointerCancel: () => void
  }
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
    <div data-i={index} data-uid={uid} className={`relative rounded-lg border border-border bg-surface p-4 ${drag.dragging ? 'opacity-50' : ''}`}>
      {/* Линия места вставки: отвечает на вопрос «выше или ниже встанет», которого
          подсветка рамки не решала. */}
      {drag.line && (
        <span
          aria-hidden
          className={`pointer-events-none absolute inset-x-0 h-0.5 rounded-full bg-accent ${drag.line === 'before' ? '-top-2' : '-bottom-2'}`}
        />
      )}
      <div className="mb-2.5 flex items-center gap-2">
        {/* Ручка — полная тач-цель: иконка мелкая, а промах пальцем по ней означает
            прокрутку страницы вместо переноса. `touch-none` не даёт жесту с ручки
            уйти в прокрутку. Из таб-порядка ручка убрана: с клавиатуры блок двигают
            соседние кнопки и Alt+↑/↓, а фокус на пустышке только мешал бы. */}
        <Tooltip label={t('editor.dragToReorder', lang)}>
          <IconButton variant="ghost" tabIndex={-1} label={t('editor.dragToReorder', lang)} {...drag.handle} className="cursor-grab touch-none select-none active:cursor-grabbing">
            <GripVertical size={iconSizeFor()} />
          </IconButton>
        </Tooltip>
        {item.type === 'step' ? (
          <span className="font-mono text-[0.78125rem] text-muted">{stepNumber === null ? '•' : t('editor.itemN', lang).replace('{n}', String(stepNumber))}</span>
        ) : (
          <span className="inline-flex items-center gap-1 font-mono text-[0.78125rem] text-muted">
            <TypeIcon size={13} />
            {blockLabel(item.type, lang)}
          </span>
        )}
        {/* Порядок и удаление — иконочные кнопки общей шкалы: пальцем цель вырастает
            до 44px, мышью остаётся плотной. «В начало» и «в конец» уехали в «…»:
            пять целей по 44 не помещаются в шапку 390px рядом с номером пункта, а
            вторичному место в меню, а не второй строкой. */}
        <div className="ml-auto flex items-center gap-1">
          <Tooltip label={t('editor.moveUp', lang)}>
            <IconButton variant="ghost" label={t('editor.moveUp', lang)} onClick={() => onMove(-1)} disabled={isFirst}>
              <ChevronUp size={iconSizeFor()} />
            </IconButton>
          </Tooltip>
          <Tooltip label={t('editor.moveDown', lang)}>
            <IconButton variant="ghost" label={t('editor.moveDown', lang)} onClick={() => onMove(1)} disabled={isLast}>
              <ChevronDown size={iconSizeFor()} />
            </IconButton>
          </Tooltip>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <IconButton variant="ghost" label={t('editor.blockActions', lang)}>
                <MoreHorizontal size={iconSizeFor()} />
              </IconButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => onMoveToEdge('top')} disabled={isFirst}>
                <ChevronsUp size={iconSizeFor('xs')} /> {t('editor.moveTop', lang)}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onMoveToEdge('bottom')} disabled={isLast}>
                <ChevronsDown size={iconSizeFor('xs')} /> {t('editor.moveBottom', lang)}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Tooltip label={t('editor.remove', lang)}>
            <IconButton variant="danger" label={t('editor.remove', lang)} onClick={onRemove}>
              <Trash2 size={iconSizeFor()} />
            </IconButton>
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
