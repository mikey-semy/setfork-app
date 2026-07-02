'use client'

import { useEffect, useState } from 'react'
import { Check, Copy, Download, GitBranch } from 'lucide-react'

/** Показывает git-команды клонирования списка через bundle (read-only). */
export function CloneBox({ base, slug, lang }: { base: string; slug: string; lang: 'en' | 'ru' }) {
  const [copied, setCopied] = useState(false)
  const [origin, setOrigin] = useState('')
  useEffect(() => setOrigin(window.location.origin), [])
  const cmd = `curl -LO ${origin}${base}/repo.bundle\ngit clone ${slug}.bundle`
  const copy = () => {
    navigator.clipboard.writeText(cmd).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }
  return (
    <div>
      <div className="mb-1.5 flex items-center gap-1.5 font-mono text-[10.5px] uppercase tracking-[0.12em] text-muted">
        <GitBranch size={12} /> {lang === 'ru' ? 'Клонировать (git)' : 'Clone with git'}
      </div>
      <div className="relative rounded-md border border-border bg-surface-2 px-3 py-2.5 pr-9 font-mono text-[11.5px] leading-relaxed text-ink">
        <div className="whitespace-pre-wrap break-all">{cmd}</div>
        <button
          onClick={copy}
          aria-label="copy"
          className="absolute right-1.5 top-1.5 grid h-6 w-6 place-items-center rounded text-muted hover:text-ink"
        >
          {copied ? <Check size={13} className="text-ok" /> : <Copy size={13} />}
        </button>
      </div>
      <a href={`${base}/repo.bundle`} className="mt-1.5 inline-flex items-center gap-1.5 text-[12px] text-accent hover:underline">
        <Download size={12} /> {slug}.bundle
      </a>
    </div>
  )
}
