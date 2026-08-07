'use client'

import { Eye, Pencil, Redo2, Undo2 } from 'lucide-react'
import { Tooltip } from '@/shared/ui/Tooltip'
import { t, type Lang } from '@/shared/i18n'

const BTN = 'inline-flex items-center gap-1 rounded-md border px-2 py-1'

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
        <button type="button" onClick={onUndo} disabled={!canUndo} className={`${BTN} border-border disabled:opacity-40 enabled:hover:border-border-strong enabled:text-ink-2`}>
          <Undo2 size={13} /> {t('editor.undo', lang)}
        </button>
      </Tooltip>
      <Tooltip label={t('editor.redoHint', lang)}>
        <button type="button" onClick={onRedo} disabled={!canRedo} className={`${BTN} border-border disabled:opacity-40 enabled:hover:border-border-strong enabled:text-ink-2`}>
          <Redo2 size={13} /> {t('editor.redo', lang)}
        </button>
      </Tooltip>
      <Tooltip label={t(preview ? 'editTip' : 'previewTip', lang)}>
        <button type="button" onClick={onTogglePreview} aria-pressed={preview} className={`${BTN} hover:border-border-strong ${preview ? 'border-accent text-accent' : 'border-border text-ink-2'}`}>
          {preview ? <Pencil size={13} /> : <Eye size={13} />} {t(preview ? 'editToggle' : 'previewToggle', lang)}
        </button>
      </Tooltip>
      {/* Подсказка про перетаскивание — только на широком экране: на тач-экране
          перетаскивания может не быть вовсе, и обещать его там нечестно. */}
      <span className="ml-1 hidden sm:inline">{t('editor.dragHint', lang)}</span>
    </div>
  )
}
