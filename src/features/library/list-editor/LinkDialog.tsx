'use client'

import { useState } from 'react'
import { Loader2, Sparkles } from 'lucide-react'
import { Button } from '@/shared/ui/button'
import { iconSizeFor } from '@/shared/ui/control'
import { IconButton } from '@/shared/ui/IconButton'
import { FloatingInput } from '@/shared/ui/FloatingInput'
import { OverlayPanel } from '@/shared/ui/OverlayPanel'
import { Tooltip } from '@/shared/ui/Tooltip'
import { t, type Lang } from '@/shared/i18n'
import { fetchLinkTitleAction } from '../actions/ai'

export type LinkValue = { label: string; url: string }

/**
 * Ссылка вводится В ОТДЕЛЬНОМ ОКНЕ — как в Telegram, Google Docs и любом текстовом
 * редакторе (решение владельца 09.08.2026).
 *
 * Так это и должно быть: адрес нужен один раз при вводе, а место в форме занимал
 * всегда — поле «https://…» стояло в ряду наравне с подписью и на телефоне
 * съедало половину строки. В списке остаются короткие чипы, а правка открывает то
 * же окно.
 */
export function LinkDialog({
  open,
  initial,
  onSave,
  onClose,
  lang,
}: {
  open: boolean
  /** Значение для правки; пусто — добавление новой ссылки. */
  initial?: LinkValue
  onSave: (v: LinkValue) => void
  onClose: () => void
  lang: Lang
}) {
  // Значение берётся при монтировании: окно пересоздаётся на каждую ссылку
  // (ChipList даёт ему ключ), поэтому сбрасывать поля вручную не нужно.
  const [label, setLabel] = useState(initial?.label ?? '')
  const [url, setUrl] = useState(initial?.url ?? '')
  const [busy, setBusy] = useState(false)

  const urlOk = /^https?:\/\/\S+/i.test(url.trim())

  async function pullTitle() {
    if (busy || !urlOk) return
    setBusy(true)
    const res = await fetchLinkTitleAction(url.trim())
    setBusy(false)
    if ('label' in res) setLabel(res.label)
  }

  // При записи ссылка живёт, если заполнено ХОТЬ ЧТО-ТО: подпись без адреса —
  // законная ссылка-заметка (см. toProposedItems). Кнопка знает то же правило,
  // иначе правку такой ссылки нельзя было бы сохранить.
  const ready = Boolean(label.trim() || url.trim())

  function save() {
    if (!ready) return
    onSave({ label: label.trim(), url: url.trim() })
    onClose()
  }

  return (
    <OverlayPanel
      open={open}
      onClose={onClose}
      title={t('editor.linkDialogTitle', lang)}
      width={380}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('cancel', lang)}
          </Button>
          <Button variant="primary" onClick={save} disabled={!ready}>
            {initial ? t('saveChanges', lang) : t('editor.linkAdd', lang)}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        {/* Метки живут В ПОЛЯХ и поднимаются при вводе: подписи над полями занимали
            в этом окне половину высоты (замечание владельца 09.08.2026). */}
        <FloatingInput
          label={t('editor.linkLabel', lang)}
          value={label}
          onChange={setLabel}
          // Подтянуть заголовок страницы — внутри поля: это действие ЭТОГО поля.
          trailing={
            <Tooltip label={t('editor.linkTitleFromUrl', lang)}>
              <IconButton size="sm" variant="ghost" onClick={() => void pullTitle()} disabled={busy || !urlOk} label={t('editor.linkTitleFromUrl', lang)} className="hover:text-accent">
                {busy ? <Loader2 size={iconSizeFor('sm')} className="animate-spin" /> : <Sparkles size={iconSizeFor('sm')} />}
              </IconButton>
            </Tooltip>
          }
        />

        <FloatingInput
          label={t('editor.linkUrl', lang)}
          value={url}
          onChange={setUrl}
          inputClassName="font-mono"
          inputMode="url"
          autoFocus
          // Enter в поле адреса — как «Добавить»: руки не уходят с клавиатуры.
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              save()
            }
          }}
        />
      </div>
    </OverlayPanel>
  )
}
