'use client'

import { Eye, Pencil, Redo2, Undo2 } from 'lucide-react'
import { Button } from '@/shared/ui/button'
import { iconSizeFor, TOUCH_MIN_H } from '@/shared/ui/control'
import { Tooltip } from '@/shared/ui/Tooltip'
import { t, type Lang } from '@/shared/i18n'

/** Верхний ряд редактора: отмена, повтор и переключатель предпросмотра. */
export function EditorToolbar({
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  preview,
  onTogglePreview,
  lang,
}: {
  canUndo: boolean
  canRedo: boolean
  onUndo: () => void
  onRedo: () => void
  preview: boolean
  onTogglePreview: () => void
  lang: Lang
}) {
  return (
    <div className="flex items-center gap-2 text-[0.78125rem] text-muted">
      <Tooltip label={t('editor.undoHint', lang)}>
        <Button size="sm" onClick={onUndo} disabled={!canUndo} className={TOUCH_MIN_H}>
          <Undo2 size={iconSizeFor('sm')} /> {t('editor.undo', lang)}
        </Button>
      </Tooltip>
      <Tooltip label={t('editor.redoHint', lang)}>
        <Button size="sm" onClick={onRedo} disabled={!canRedo} className={TOUCH_MIN_H}>
          <Redo2 size={iconSizeFor('sm')} /> {t('editor.redo', lang)}
        </Button>
      </Tooltip>
      <Tooltip label={t(preview ? 'editTip' : 'previewTip', lang)}>
        <Button size="sm" onClick={onTogglePreview} aria-pressed={preview} className={`${TOUCH_MIN_H} ${preview ? 'border-accent text-accent' : ''}`}>
          {preview ? <Pencil size={iconSizeFor('sm')} /> : <Eye size={iconSizeFor('sm')} />} {t(preview ? 'editToggle' : 'previewToggle', lang)}
        </Button>
      </Tooltip>
      {/* Подсказка — только на широком экране: половина её про Alt+↑/↓, а клавиатуры
          на телефоне нет. Сам перенос работает и пальцем. */}
      <span className="ml-1 hidden sm:inline">{t('editor.dragHint', lang)}</span>
    </div>
  )
}
