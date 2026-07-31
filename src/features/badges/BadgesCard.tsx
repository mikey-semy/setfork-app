'use client'

import { useState } from 'react'
import { Copy } from 'lucide-react'
import { Button } from '@/shared/ui/button'
import type { Lang } from '@/shared/i18n'

const KINDS = ['stars', 'forks', 'runs', 'version'] as const

/** Блок SVG-бейджей списка: превью + Markdown-сниппет для вставки в README. */
export function BadgesCard({ owner, slug, origin, lang }: { owner: string; slug: string; origin: string; lang: Lang }) {
  const ru = lang === 'ru'
  const base = `${origin}/${owner}/${slug}`
  const [copied, setCopied] = useState<string | null>(null)

  const copy = (kind: string, text: string) => {
    void navigator.clipboard?.writeText(text)
    setCopied(kind)
    setTimeout(() => setCopied((c) => (c === kind ? null : c)), 1400)
  }

  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <div className="mb-1 text-[13px] font-semibold text-ink">{ru ? 'Бейджи' : 'Badges'}</div>
      <p className="mb-3 text-[12px] text-muted">
        {ru ? 'Живой бейдж списка — вставь в README проекта, доки или блог.' : 'A live badge for this list — drop it in your project README, docs or blog.'}
      </p>
      <div className="flex flex-col gap-2">
        {KINDS.map((kind) => {
          const url = `${base}/badge/${kind}.svg`
          const md = `[![${kind}](${url})](${base})`
          return (
            <div key={kind} className="flex items-center gap-2">
              {/* eslint-disable-next-line @next/next/no-img-element -- внешний SVG-ассет по URL */}
              <img src={url} alt={kind} height={20} className="h-5 shrink-0" />
              <code className="min-w-0 flex-1 truncate rounded-md bg-surface-2 px-2 py-1 font-mono text-[11px] text-ink-2">{md}</code>
              <Button variant="ghost" size="xs" className="shrink-0 p-1" onClick={() => copy(kind, md)} aria-label={ru ? 'Скопировать' : 'Copy'}>
                <Copy size={12} /> {copied === kind ? (ru ? 'ок' : 'ok') : ''}
              </Button>
            </div>
          )
        })}
      </div>
    </div>
  )
}
