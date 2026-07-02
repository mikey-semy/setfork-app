'use client'

import { useRouter } from 'next/navigation'
import { ArrowRight } from 'lucide-react'

// Выбор пары версий выпадающими списками — масштабируется на десятки/сотни версий.
export function VersionPicker({
  base,
  versions,
  from,
  to,
  view,
  fromLabel,
  toLabel,
}: {
  base: string
  versions: number[]
  from: number
  to: number
  view: string
  fromLabel: string
  toLabel: string
}) {
  const router = useRouter()
  const go = (f: number, t: number) => router.push(`${base}?from=${f}&to=${t}&view=${view}`)
  const sel = 'rounded-md border border-border bg-surface-2 px-2 py-1.5 font-mono text-[13px] text-ink outline-none'

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-[12px] text-muted">{fromLabel}</span>
      <select value={from} onChange={(e) => go(Number(e.target.value), to)} className={sel}>
        {versions.map((v) => (
          <option key={v} value={v}>
            v{v}
          </option>
        ))}
      </select>
      <ArrowRight size={14} className="text-muted" />
      <span className="text-[12px] text-muted">{toLabel}</span>
      <select value={to} onChange={(e) => go(from, Number(e.target.value))} className={sel}>
        {versions.map((v) => (
          <option key={v} value={v}>
            v{v}
          </option>
        ))}
      </select>
    </div>
  )
}
