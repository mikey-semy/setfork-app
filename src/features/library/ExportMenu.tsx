'use client'

import { FileCode, FileDown, Printer } from 'lucide-react'
import type { Lang } from '@/shared/i18n'

// Экспорт списка: печать (через браузер → PDF), скачивание .md / .html.
export function ExportMenu({ base, lang }: { base: string; lang: Lang }) {
  const ru = lang === 'ru'
  const btn =
    'inline-flex items-center gap-1.5 rounded-md border border-border bg-surface-2 px-2.5 py-1.5 text-[12.5px] text-ink-2 hover:border-border-strong hover:text-ink'
  return (
    <div className="flex flex-wrap gap-1.5">
      <button type="button" onClick={() => window.print()} className={btn}>
        <Printer size={13} /> {ru ? 'Печать / PDF' : 'Print / PDF'}
      </button>
      <a href={`${base}/export?format=md`} className={btn}>
        <FileDown size={13} /> .md
      </a>
      <a href={`${base}/export?format=html`} className={btn}>
        <FileCode size={13} /> .html
      </a>
    </div>
  )
}
