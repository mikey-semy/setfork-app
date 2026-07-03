'use client'

import { useEffect, useState } from 'react'
import { Check, ChevronDown, Copy, FileCode, FileDown, GitBranch, ListChecks, Printer, Terminal } from 'lucide-react'
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '@/shared/ui/dropdown-menu'
import { t, type Lang } from '@/shared/i18n'

/** GitHub-подобная кнопка «Code»: clone-URL (smart-HTTP) + копирование + bundle. */
export function CloneDropdown({ base, slug, lang }: { base: string; slug: string; lang: Lang }) {
  const [origin, setOrigin] = useState('')
  const [copied, setCopied] = useState(false)
  useEffect(() => setOrigin(window.location.origin), [])
  const cloneUrl = `${origin}${base}.git`

  const copy = () => {
    navigator.clipboard.writeText(cloneUrl).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="inline-flex items-center gap-1.5 rounded-md bg-ok px-3.5 py-1.5 text-[13px] font-semibold text-white hover:opacity-90">
          <ListChecks size={15} /> {t('cloneMenuLabel', lang)} <ChevronDown size={13} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-[340px] p-3">
        <div className="mb-1.5 flex items-center gap-1.5 text-[12.5px] font-semibold text-ink">
          <Terminal size={13} className="text-muted" /> {t('cloneHeading', lang)}
        </div>
        <div className="flex items-center gap-1.5 rounded-md border border-border bg-surface-2 px-2 py-1.5">
          <input
            readOnly
            value={cloneUrl}
            onFocus={(e) => e.currentTarget.select()}
            className="min-w-0 flex-1 bg-transparent font-mono text-[12px] text-ink outline-none"
          />
          <button onClick={copy} aria-label={t('copyUrl', lang)} className="shrink-0 text-muted hover:text-ink">
            {copied ? <Check size={14} className="text-ok" /> : <Copy size={14} />}
          </button>
        </div>
        <p className="mt-1.5 text-[11.5px] text-ink-2">{t('cloneHttpsHint', lang)}</p>
        <p className="mt-0.5 text-[11px] text-muted">{t('cloneAuthHint', lang)}</p>

        <div className="mt-2.5 border-t border-border pt-2">
          <div className="mb-1 px-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-muted">{t('downloadHeading', lang)}</div>
          <button
            type="button"
            onClick={() => window.print()}
            className="flex w-full items-center gap-2 rounded px-1.5 py-1.5 text-left text-[12.5px] text-ink-2 hover:bg-surface-2 hover:text-ink"
          >
            <Printer size={14} className="text-muted" /> {t('printPdf', lang)}
          </button>
          <a href={`${base}/export?format=md`} className="flex items-center gap-2 rounded px-1.5 py-1.5 text-[12.5px] text-ink-2 hover:bg-surface-2 hover:text-ink">
            <FileDown size={14} className="text-muted" /> {t('exportMd', lang)}
          </a>
          <a href={`${base}/export?format=html`} className="flex items-center gap-2 rounded px-1.5 py-1.5 text-[12.5px] text-ink-2 hover:bg-surface-2 hover:text-ink">
            <FileCode size={14} className="text-muted" /> {t('exportHtml', lang)}
          </a>
          <a href={`${base}/repo.bundle`} className="flex items-center gap-2 rounded px-1.5 py-1.5 text-[12.5px] text-ink-2 hover:bg-surface-2 hover:text-ink">
            <GitBranch size={14} className="text-muted" /> {t('downloadBundle', lang)}
          </a>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
