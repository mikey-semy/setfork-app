'use client'

import type { PointerEvent, ReactNode } from 'react'
import { Heading } from 'lucide-react'
import { BubbleTextEditor } from '@/shared/ui/BubbleTextEditor'
import { TEXT, iconSizeFor } from '@/shared/ui/control'
import { t, type Lang } from '@/shared/i18n'
import type { BlockType } from '../blocks'
import type { EditorItem } from '../editor'
import { BlockCardHeader } from './BlockCardHeader'
import { FileBlockBody, ImageBlockBody, TextBlockBody, VideoBlockBody } from './MediaBlocks'
import { PollBlockBody } from './PollBlockBody'
import { ProductBlockBody } from './ProductBlockBody'
import { QuizBlockBody } from './QuizBlockBody'
import { StepBlockBody } from './StepBlockBody'
import type { DropKind } from './FileDrop'
import { cardClass } from '@/shared/ui/card-style'

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
  /** Вставить ниже блок того же типа — «плюс» в жёлобе. */
  onInsertBelow: () => void
  /** Смена типа блока на месте — выбор в слэш-меню. */
  onRetype: (type: BlockType) => void
  /** Открыть разговор о правке блока; у видов без текстовых полей его нет. */
  onChat?: () => void
  chatActive?: boolean
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
  onRetype,
  lang,
  isUploading,
  onUpload,
}: {
  item: EditorItem
  index: number
  onPatch: (p: Partial<EditorItem>) => void
  onRetype: (type: BlockType) => void
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
      return <TextBlockBody value={item.text} onChange={(text) => onPatch({ text })} onRetype={onRetype} lang={lang} />
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
 * Карточка блока: линия места вставки, шапка с действиями, поле «урок/секция» и тело
 * по типу блока. Сама она только собирает — за шапку отвечает BlockCardHeader, за
 * содержимое тип блока.
 *
 * Стрелки и Alt+↑/↓ не вспомогательные, а полноценный путь: перенос указателем удобен,
 * но с клавиатуры он недоступен по своей природе.
 */
export function BlockCard({ item, index, uid, stepNumber, isFirst, isLast, lang, drag, onPatch, onMove, onMoveToEdge, onRemove, onInsertBelow, onRetype, isUploading, onUpload, insertAfter, onChat, chatActive }: BlockCardProps) {
  return (
    // `group/card` — для жёлоба: он проявляется, когда указатель на ЭТОЙ карточке.
    <div data-i={index} data-uid={uid} className={cardClass({ className: `group/card relative ${drag.dragging ? 'opacity-50' : ''}` })}>
      {/* Линия места вставки: отвечает на вопрос «выше или ниже встанет», которого
          подсветка рамки не решала. */}
      {drag.line && (
        <span
          aria-hidden
          className={`pointer-events-none absolute inset-x-0 h-0.5 rounded-full bg-accent ${drag.line === 'before' ? '-top-2' : '-bottom-2'}`}
        />
      )}
      <BlockCardHeader
        type={item.type}
        stepNumber={stepNumber}
        isFirst={isFirst}
        isLast={isLast}
        lang={lang}
        drag={drag}
        onMove={onMove}
        onMoveToEdge={onMoveToEdge}
        onRemove={onRemove}
        onInsertBelow={onInsertBelow}
        onChat={onChat}
        chatActive={chatActive}
      />

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
          textareaClassName={`${TEXT.bodySm} font-semibold placeholder:font-normal placeholder:text-muted`}
          lang={lang}
          ariaLabel={t('editor.sectionOfBlockN', lang).replace('{n}', String(index + 1))}
          placeholder={t('editor.sectionPh', lang)}
        />
      </div>

      <BlockBody item={item} index={index} onPatch={onPatch} onRetype={onRetype} lang={lang} isUploading={isUploading} onUpload={onUpload} />
      {insertAfter}
    </div>
  )
}
