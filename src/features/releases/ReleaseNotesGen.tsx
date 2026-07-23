'use client'

import { useState } from 'react'
import { Loader2, Sparkles } from 'lucide-react'
import { MarkdownEditor } from '@/shared/ui/MarkdownEditor'
import type { Lang } from '@/shared/i18n'
import { generateReleaseNotes } from './actions'

/**
 * Поле заметок релиза с автогенерацией: кнопка «Сгенерировать из изменений»
 * читает выбранную версию (hidden input[name=version] от VersionSelect в той же
 * форме), зовёт серверный дифф-чейнджлог и ПЕРЕмонтирует редактор с результатом
 * (у MarkdownEditor нет управляемого value — двигаем через key + defaultValue).
 * Заполненное можно править перед публикацией.
 */
export function ReleaseNotesGen({
  templateId,
  owner,
  slug,
  lang,
  labels,
}: {
  templateId: string
  owner: string
  slug: string
  lang: Lang
  labels: { notes: string; generate: string; empty: string; placeholder: string }
}) {
  const [notes, setNotes] = useState('')
  const [seed, setSeed] = useState(0)
  const [busy, setBusy] = useState(false)
  const [hint, setHint] = useState('')

  const generate = async () => {
    const v = Number(document.querySelector<HTMLInputElement>('input[name="version"]')?.value)
    if (!v) return
    setBusy(true)
    setHint('')
    try {
      const md = await generateReleaseNotes(templateId, v, lang)
      if (md) {
        setNotes(md)
        setSeed((s) => s + 1)
      } else {
        setHint(labels.empty)
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[12.5px] font-semibold text-ink">{labels.notes}</span>
        <button
          type="button"
          onClick={generate}
          disabled={busy}
          className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-[12px] font-medium text-ink-2 hover:border-border-strong hover:text-ink disabled:opacity-50"
        >
          {busy ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} className="text-accent" />}
          {labels.generate}
        </button>
      </div>
      <MarkdownEditor
        key={seed}
        name="notes"
        defaultValue={notes}
        rows={8}
        placeholder={labels.placeholder}
        maxLength={50000}
        lang={lang}
        refScope={{ owner, slug }}
      />
      {hint && <p className="text-[12px] text-muted">{hint}</p>}
    </div>
  )
}
