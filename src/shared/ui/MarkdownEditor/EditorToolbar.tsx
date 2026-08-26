'use client'
import { AtSign, ImageIcon, Paperclip, SmilePlus } from 'lucide-react'
import { t, type Lang } from '@/shared/i18n'
import { markdownToolbarGroups } from '../markdown-toolbar'
import { Tooltip } from '../Tooltip'
import { EmojiPickerPopover } from '../EmojiPickerPopover'
import type { TextOps } from '../use-text-ops'

const btn = 'inline-flex h-7 w-7 items-center justify-center rounded-md text-muted hover:bg-surface hover:text-ink'

/**
 * Верхняя панель редактора: переключатель «Написать/Просмотр» и инструменты.
 * Инструменты форматирования — общий набор (`markdownToolbarGroups`), справа своё:
 * картинка, файл, упоминание, эмодзи.
 */
export function EditorToolbar({
  lang,
  tab,
  onTab,
  ops,
  onPickImage,
  onPickFile,
}: {
  lang: Lang
  tab: 'write' | 'preview'
  onTab: (tab: 'write' | 'preview') => void
  ops: Pick<TextOps, 'surround' | 'linePrefix' | 'insertAt'>
  onPickImage: () => void
  onPickFile: () => void
}) {
  const groups = markdownToolbarGroups(ops, lang)
  return (
    <div className="flex flex-wrap items-center gap-1 border-b border-border bg-surface-2 px-1.5 py-1">
      <div className="mr-1 flex overflow-hidden rounded-md border border-border">
        {(['write', 'preview'] as const).map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => onTab(k)}
            className={`px-2.5 py-1 text-body-sm font-semibold ${tab === k ? 'bg-surface text-ink' : 'bg-surface-2 text-muted hover:text-ink'}`}
          >
            {k === 'write' ? t('editor.write', lang) : t('editor.preview', lang)}
          </button>
        ))}
      </div>

      {tab === 'write' && (
        <div className="flex flex-wrap items-center gap-0.5">
          {groups.map((group, gi) => (
            <div key={gi} className="flex items-center gap-0.5">
              {gi > 0 && <span className="mx-1 h-4 w-px bg-border" />}
              {group.map((tool, i) => (
                <Tooltip key={i} label={tool.t}>
                  <button type="button" aria-label={tool.t} onClick={tool.run} className={btn}>
                    <tool.icon size={15} />
                  </button>
                </Tooltip>
              ))}
            </div>
          ))}
          <span className="mx-1 h-4 w-px bg-border" />
          <IconButton label={t('editor.image', lang)} onClick={onPickImage} icon={<ImageIcon size={15} />} />
          <IconButton label={t('editor.attachFile', lang)} onClick={onPickFile} icon={<Paperclip size={15} />} />
          <IconButton label={t('editor.mention', lang)} onClick={() => ops.insertAt('@')} icon={<AtSign size={15} />} />
          {/* Якорный поповер (рядом с кнопкой), а не centered-модалка; портал в body
              спасает от overflow редактора. Тултип — на самой кнопке. */}
          <EmojiPickerPopover
            lang={lang}
            side="top"
            tooltip={t('editor.emoji', lang)}
            onPick={(native) => ops.insertAt(native)}
            button={
              <button type="button" aria-label={t('editor.emoji', lang)} className={btn}>
                <SmilePlus size={15} />
              </button>
            }
          />
        </div>
      )}
    </div>
  )
}

function IconButton({ label, onClick, icon }: { label: string; onClick: () => void; icon: React.ReactNode }) {
  return (
    <Tooltip label={label}>
      <button type="button" aria-label={label} onClick={onClick} className={btn}>
        {icon}
      </button>
    </Tooltip>
  )
}
