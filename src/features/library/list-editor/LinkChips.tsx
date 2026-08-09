'use client'

import { useState } from 'react'
import { Link2, X } from 'lucide-react'
import { Badge } from '@/shared/ui/badge'
import { iconSizeFor, TOUCH_MIN_H } from '@/shared/ui/control'
import { Tooltip } from '@/shared/ui/Tooltip'
import { t, type Lang } from '@/shared/i18n'
import { AddLink } from './block-fields'
import { LinkDialog, type LinkValue } from './LinkDialog'

/** Домен вместо полного адреса: смотреть на «https://…» незачем, а места он
 *  занимает много. Полный адрес живёт в подсказке. */
export function linkHost(raw: string): string {
  const s = raw.trim()
  if (!s) return ''
  try {
    return new URL(s.includes('://') ? s : `https://${s}`).host
  } catch {
    return s
  }
}

/**
 * Ссылки шага — чипами, ввод и правка в отдельном окне (LinkDialog).
 *
 * Раньше каждая ссылка занимала целый ряд из двух полей: подпись и «https://…».
 * На телефоне ряд не помещался, а смотреть на адрес всё равно незачем — он нужен
 * один раз при вводе. В карточке остаётся то, что человек читает: подпись и домен.
 *
 * Чип собран на общем `Badge`, кнопка добавления — на общем `AddLink` (том же, что
 * у подпунктов): своих кнопок и рамок здесь не рисуем.
 */
export function LinkChips({
  refs,
  onChange,
  lang,
}: {
  refs: { label: string; url?: string }[]
  onChange: (next: { label: string; url?: string }[]) => void
  lang: Lang
}) {
  // null — окно закрыто; -1 — добавляем новую; иначе правим ссылку с этим номером.
  const [editing, setEditing] = useState<number | null>(null)

  const save = (v: LinkValue) => {
    if (editing === null) return
    onChange(editing < 0 ? [...refs, v] : refs.map((r, i) => (i === editing ? v : r)))
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {refs.map((r, i) => (
        <Badge key={i} variant="soft" className="gap-1 bg-surface-2 pr-1 font-medium text-ink-2">
          <Tooltip label={r.url || t('editor.linkUrl', lang)}>
            <button
              type="button"
              onClick={() => setEditing(i)}
              aria-label={`${r.label || linkHost(r.url ?? '')} — ${t('editor.linkEdit', lang)}`}
              className={`flex min-w-0 items-center gap-1.5 hover:text-ink ${TOUCH_MIN_H}`}
            >
              <Link2 size={iconSizeFor('xs')} className="shrink-0 text-muted" />
              <span className="max-w-[10rem] truncate">{r.label || linkHost(r.url ?? '')}</span>
              {r.label && r.url ? <span className="max-w-[8rem] truncate font-mono text-muted">{linkHost(r.url)}</span> : null}
            </button>
          </Tooltip>
          {/* Крестик того же вида, что у тегов (TagInput): один приём на всё
              приложение, а не своя кнопка удаления в каждом списке чипов. */}
          <button
            type="button"
            onClick={() => onChange(refs.filter((_, xi) => xi !== i))}
            aria-label={t('editor.removeLink', lang)}
            className="grid size-4 place-items-center rounded-full text-muted hover:bg-surface hover:text-danger"
          >
            <X size={11} />
          </button>
        </Badge>
      ))}

      <AddLink onClick={() => setEditing(-1)}>{t('editor.addLinkWord', lang)}</AddLink>

      <LinkDialog
        open={editing !== null}
        initial={editing !== null && editing >= 0 ? { label: refs[editing]?.label ?? '', url: refs[editing]?.url ?? '' } : undefined}
        onSave={save}
        onClose={() => setEditing(null)}
        lang={lang}
      />
    </div>
  )
}
