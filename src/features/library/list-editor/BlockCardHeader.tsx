'use client'

import type { ReactNode } from 'react'
import { ChevronDown, ChevronsDown, ChevronsUp, ChevronUp, GripVertical, MoreHorizontal, Plus, Trash2 } from 'lucide-react'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/shared/ui/dropdown-menu'
import { iconSizeFor } from '@/shared/ui/control'
import { IconButton } from '@/shared/ui/IconButton'
import { Tooltip } from '@/shared/ui/Tooltip'
import { t, type Lang } from '@/shared/i18n'
import type { BlockType } from '../blocks'
import { BLOCK_ICON, blockLabel } from './block-meta'
import type { CardDrag } from './BlockCard'

/**
 * Шапка карточки блока: жёлоб (перенос и вставка), номер или подпись типа, порядок,
 * «ещё» и удаление.
 *
 * Отдельно от карточки, потому что причина меняться у неё своя — состав и порядок
 * действий над блоком. Что показывать ВНУТРИ карточки, решает тип блока, и это другой
 * разговор.
 *
 * Все цели одной шкалы: пальцем они вырастают до 44px, мышью остаются плотными.
 * «В начало» и «в конец» живут в «…» — пять целей по 44 не помещаются в шапку 390px
 * рядом с номером пункта, а вторичному место в меню, а не второй строкой.
 */
export function BlockCardHeader({
  type,
  stepNumber,
  isFirst,
  isLast,
  lang,
  drag,
  onMove,
  onMoveToEdge,
  onRemove,
  onInsertBelow,
  chat,
}: {
  type: BlockType
  /** Номер шага в нумерованном списке; null — маркер вместо числа. */
  stepNumber: number | null
  isFirst: boolean
  isLast: boolean
  lang: Lang
  drag: CardDrag
  onMove: (dir: -1 | 1) => void
  onMoveToEdge: (edge: 'top' | 'bottom') => void
  onRemove: () => void
  /** Вставить ниже блок ТОГО ЖЕ типа — жёлобный «плюс». */
  onInsertBelow: () => void
  /** Кнопка чата правки; у видов без текстовых полей её нет. */
  chat?: ReactNode
}) {
  const TypeIcon = BLOCK_ICON[type]
  return (
    <div className="mb-2.5 flex items-center gap-2">
      {/* ЖЁЛОБ. На широком экране колонка уезжает в левое поле страницы (у формы
          читаемая ширина 720px, по бокам пусто) и проявляется при наведении на
          карточку — так устроены Notion и Linear, и перенос ищут именно там. Узкому
          экрану поля взять неоткуда, и та же пара живёт первой в шапке.
          Один узел на оба случая: вторая копия ручки разъехалась бы с первой.

          Порог именно xl: на 1024 поле страницы всего 32px, и вынесенный жёлоб уходит
          ПОД боковое меню (240px) — замер 08.08.2026 показал, что нажатие достаётся
          меню, а не кнопке. С 1280 запас 160px даже при открытом меню. */}
      <div className="flex items-center gap-1 xl:absolute xl:top-3.5 xl:-left-19 xl:opacity-0 xl:transition-opacity xl:group-focus-within/card:opacity-100 xl:group-hover/card:opacity-100">
        {/* «Плюс» вставляет блок ТОГО ЖЕ вида одним нажатием — подряд идут шаги, и это
            самый частый выбор. Другой вид даёт веер между карточками и «/» в тексте:
            третьего способа выбирать тип заводить незачем. */}
        <Tooltip label={`${t('editor.addBlockBelow', lang)}: ${blockLabel(type, lang)}`}>
          <IconButton variant="ghost" label={`${t('editor.addBlockBelow', lang)}: ${blockLabel(type, lang)}`} onClick={onInsertBelow} className="max-xl:hidden">
            <Plus size={iconSizeFor()} />
          </IconButton>
        </Tooltip>
        {/* Ручка — полная тач-цель: иконка мелкая, а промах пальцем по ней означает
            прокрутку страницы вместо переноса. `touch-none` не даёт жесту с ручки уйти
            в прокрутку. Из таб-порядка ручка убрана: с клавиатуры блок двигают соседние
            кнопки и Alt+↑/↓, а фокус на пустышке только мешал бы. */}
        <Tooltip label={t('editor.dragToReorder', lang)}>
          <IconButton variant="ghost" tabIndex={-1} label={t('editor.dragToReorder', lang)} {...drag.handle} className="cursor-grab touch-none select-none active:cursor-grabbing">
            <GripVertical size={iconSizeFor()} />
          </IconButton>
        </Tooltip>
      </div>

      {type === 'step' ? (
        <span className="shrink-0 font-mono text-[0.78125rem] whitespace-nowrap text-muted">
          {stepNumber === null ? '•' : t('editor.itemN', lang).replace('{n}', String(stepNumber))}
        </span>
      ) : (
        <span className="inline-flex shrink-0 items-center gap-1 font-mono text-[0.78125rem] whitespace-nowrap text-muted">
          <TypeIcon size={13} />
          {blockLabel(type, lang)}
        </span>
      )}

      <div className="ml-auto flex items-center gap-1">
        {chat}
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
  )
}
