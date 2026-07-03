'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Check, ChevronDown, Code2, Copy, FileCode, FileDown, GitBranch, ListChecks, Printer, Sparkles, Terminal } from 'lucide-react'
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '@/shared/ui/dropdown-menu'
import { t, type Lang } from '@/shared/i18n'

/** Кнопка «Use»: как использовать список — git-clone, экспорт, MCP для агентов, embed. */
export function CloneDropdown({ base, slug, lang }: { base: string; slug: string; lang: Lang }) {
  const [origin, setOrigin] = useState('')
  const [copied, setCopied] = useState<string | null>(null)
  useEffect(() => setOrigin(window.location.origin), [])

  const cloneUrl = `${origin}${base}.git`
  const mcpUrl = `${origin}/api/mcp`
  const embedCode = `<iframe src="${origin}${base}/embed" width="100%" height="480" style="border:1px solid #ddd;border-radius:8px" loading="lazy"></iframe>`

  const copy = (key: string, text: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(key)
      setTimeout(() => setCopied((c) => (c === key ? null : c)), 1500)
    })
  }

  const heading = (icon: React.ReactNode, label: string) => (
    <div className="mb-1.5 flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-muted">
      {icon} {label}
    </div>
  )
  const copyField = (key: string, value: string, mono = true) => (
    <div className="flex items-center gap-1.5 rounded-md border border-border bg-surface-2 px-2 py-1.5">
      <input
        readOnly
        value={value}
        onFocus={(e) => e.currentTarget.select()}
        className={`min-w-0 flex-1 bg-transparent text-[12px] text-ink outline-none ${mono ? 'font-mono' : ''}`}
      />
      <button onClick={() => copy(key, value)} aria-label={t('copyUrl', lang)} className="shrink-0 text-muted hover:text-ink">
        {copied === key ? <Check size={14} className="text-ok" /> : <Copy size={14} />}
      </button>
    </div>
  )
  const row =
    'flex items-center gap-2 rounded px-1.5 py-1.5 text-[12.5px] text-ink-2 hover:bg-surface-2 hover:text-ink'

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="inline-flex items-center gap-1.5 rounded-md bg-[var(--ok-solid)] px-3.5 py-1.5 text-[13px] font-semibold text-white hover:opacity-90">
          <ListChecks size={15} /> {t('cloneMenuLabel', lang)} <ChevronDown size={13} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-h-[80vh] w-[340px] overflow-auto p-3">
        {/* Clone / Git */}
        {heading(<Terminal size={12} />, t('cloneGitHeading', lang))}
        {copyField('clone', cloneUrl)}
        <p className="mt-1 text-[11px] text-ink-2">{t('cloneHttpsHint', lang)}</p>
        <a href={`${base}/repo.bundle`} className={`${row} mt-1`}>
          <GitBranch size={14} className="text-muted" /> {t('downloadBundle', lang)}
        </a>

        {/* Export */}
        <div className="mt-2.5 border-t border-border pt-2">
          {heading(<FileDown size={12} />, t('exportHeading', lang))}
          <button type="button" onClick={() => window.print()} className={`${row} w-full text-left`}>
            <Printer size={14} className="text-muted" /> {t('printPdf', lang)}
          </button>
          <a href={`${base}/export?format=md`} className={row}>
            <FileDown size={14} className="text-muted" /> {t('exportMd', lang)}
          </a>
          <a href={`${base}/export?format=html`} className={row}>
            <FileCode size={14} className="text-muted" /> {t('exportHtml', lang)}
          </a>
        </div>

        {/* MCP */}
        <div className="mt-2.5 border-t border-border pt-2">
          {heading(<Sparkles size={12} />, t('mcpHeading', lang))}
          {copyField('mcp', mcpUrl)}
          <p className="mt-1 text-[11px] text-ink-2">{t('mcpHint', lang)}</p>
          <Link href="/settings#mcp" className="mt-1 inline-block text-[12px] text-accent hover:underline">
            {t('getTokenLink', lang)}
          </Link>
        </div>

        {/* Embed */}
        <div className="mt-2.5 border-t border-border pt-2">
          {heading(<Code2 size={12} />, t('embedHeading', lang))}
          <div className="flex items-start gap-1.5 rounded-md border border-border bg-surface-2 px-2 py-1.5">
            <textarea
              readOnly
              value={embedCode}
              rows={3}
              onFocus={(e) => e.currentTarget.select()}
              className="min-w-0 flex-1 resize-none bg-transparent font-mono text-[11px] leading-snug text-ink outline-none"
            />
            <button onClick={() => copy('embed', embedCode)} aria-label={t('copyUrl', lang)} className="shrink-0 text-muted hover:text-ink">
              {copied === 'embed' ? <Check size={14} className="text-ok" /> : <Copy size={14} />}
            </button>
          </div>
          <p className="mt-1 text-[11px] text-ink-2">{t('embedHint', lang)}</p>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
