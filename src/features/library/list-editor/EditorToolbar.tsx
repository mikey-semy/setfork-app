'use client'

import { Code2, Eye, Info, Pencil, Redo2, Undo2 } from 'lucide-react'
import { TEXT, iconSizeFor } from '@/shared/ui/control'
import { IconButton } from '@/shared/ui/IconButton'
import { Tooltip } from '@/shared/ui/Tooltip'
import { t, type Lang } from '@/shared/i18n'

/**
 * Верхний ряд редактора: отмена, повтор, предпросмотр, правка как кода.
 *
 * Только иконки: три подписи занимали треть ширины телефона ради действий, которые
 * узнаются по значку (решение владельца 07.08). Смысл каждой — в тултипе и в
 * подписи для диктора, как у остальных иконочных кнопок приложения.
 */
export function EditorToolbar({
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  preview,
  onTogglePreview,
  code,
  onToggleCode,
  lang,
}: {
  canUndo: boolean
  canRedo: boolean
  onUndo: () => void
  onRedo: () => void
  preview: boolean
  onTogglePreview: () => void
  /** Режим «код»; кнопки нет вовсе, пока список не сохранён — канон собирает ядро
   *  по существующему списку, а у несозданного его ещё нет. */
  code?: boolean
  onToggleCode?: () => void
  lang: Lang
}) {
  return (
    <div className={`flex items-center gap-1 ${TEXT.bodySm} text-muted`}>
      <Tooltip label={t('editor.undoHint', lang)}>
        <IconButton variant="ghost" onClick={onUndo} disabled={!canUndo} label={t('editor.undo', lang)}>
          <Undo2 size={iconSizeFor()} />
        </IconButton>
      </Tooltip>
      <Tooltip label={t('editor.redoHint', lang)}>
        <IconButton variant="ghost" onClick={onRedo} disabled={!canRedo} label={t('editor.redo', lang)}>
          <Redo2 size={iconSizeFor()} />
        </IconButton>
      </Tooltip>
      <Tooltip label={t(preview ? 'editTip' : 'previewTip', lang)}>
        <IconButton
          variant="ghost"
          onClick={onTogglePreview}
          aria-pressed={preview}
          label={t(preview ? 'editToggle' : 'previewToggle', lang)}
          className={preview ? 'text-accent' : ''}
        >
          {preview ? <Pencil size={iconSizeFor()} /> : <Eye size={iconSizeFor()} />}
        </IconButton>
      </Tooltip>
      {onToggleCode && (
        <Tooltip label={t(code ? 'canon.backToBlocksTip' : 'canon.openTip', lang)}>
          <IconButton
            variant="ghost"
            onClick={onToggleCode}
            aria-pressed={code}
            label={t(code ? 'canon.backToBlocks' : 'canon.open', lang)}
            className={code ? 'text-accent' : ''}
          >
            <Code2 size={iconSizeFor()} />
          </IconButton>
        </Tooltip>
      )}
      {/* Подсказка про перенос — за кнопкой «i», а не строкой в ряду: она нужна
          один раз, а место занимала всегда (решение владельца 09.08). Тултипа
          достаточно — текст короткий и читается наведением или фокусом. */}
      <Tooltip label={t('editor.dragHint', lang)}>
        <IconButton variant="ghost" label={t('editor.dragHint', lang)} className="text-muted">
          <Info size={iconSizeFor()} />
        </IconButton>
      </Tooltip>
    </div>
  )
}
