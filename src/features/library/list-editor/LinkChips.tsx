'use client'

import { Link2 } from 'lucide-react'
import { ChipList } from '@/shared/ui/ChipList'
import { iconSizeFor } from '@/shared/ui/control'
import { t, type Lang } from '@/shared/i18n'
import type { EditorRef } from '../editor'
import { AddLink } from './block-fields'
import { LinkDialog } from './LinkDialog'

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
 * Оболочка — общий `ChipList` (тот же, что у товаров): чипы, удаление, кнопка
 * добавления и состояние «что правим» живут в ОДНОМ месте.
 */
export function LinkChips({
  refs,
  onChange,
  lang,
}: {
  refs: EditorRef[]
  onChange: (next: EditorRef[]) => void
  lang: Lang
}) {
  return (
    <ChipList
      items={refs}
      onChange={onChange}
      removeLabel={t('editor.removeLink', lang)}
      editLabel={t('editor.linkEdit', lang)}
      chipTitle={(r) => r.label || linkHost(r.url) || t('editor.linkUrl', lang)}
      chip={(r) => (
        <>
          <Link2 size={iconSizeFor('xs')} className="shrink-0 text-muted" />
          <span className="max-w-[10rem] truncate">{r.label || linkHost(r.url)}</span>
          {r.label && r.url ? <span className="max-w-[8rem] truncate font-mono text-muted">{linkHost(r.url)}</span> : null}
        </>
      )}
      addButton={(open) => <AddLink onClick={open}>{t('editor.addLinkWord', lang)}</AddLink>}
      dialog={({ open, item, save, close }) => (
        <LinkDialog
          open={open}
          initial={item}
          onSave={save}
          onClose={close}
          lang={lang}
        />
      )}
    />
  )
}
