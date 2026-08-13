'use client'

import { useRouter } from 'next/navigation'
import { ArrowLeftRight } from 'lucide-react'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select'
import { Tooltip } from '@/shared/ui/Tooltip'
import { buttonClass } from '@/shared/ui/button-style'

// Выбор пары версий (shadcn Select) — масштабируется на десятки/сотни версий.
export function VersionPicker({
  base,
  versions,
  from,
  to,
  view,
  fromLabel,
  toLabel,
  swapLabel,
}: {
  base: string
  versions: number[]
  from: number
  to: number
  view: string
  fromLabel: string
  toLabel: string
  swapLabel: string
}) {
  const router = useRouter()
  const go = (f: number, t: number) => router.push(`${base}?from=${f}&to=${t}&view=${view}`)

  const picker = (value: number, onPick: (v: number) => void) => (
    <Select value={String(value)} onValueChange={(v) => onPick(Number(v))}>
      <SelectTrigger className="w-[5.75rem] font-mono">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {versions.map((v) => (
          <SelectItem key={v} value={String(v)} className="font-mono">
            v{v}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-[0.78125rem] text-muted">{fromLabel}</span>
      {picker(from, (v) => go(v, to))}
      <Tooltip label={swapLabel}>
        <button
          type="button"
          onClick={() => go(to, from)}
          aria-label={swapLabel}
          className={buttonClass({ className: 'size-8 p-0 text-muted hover:text-ink' })}
        >
          <ArrowLeftRight size={14} />
        </button>
      </Tooltip>
      <span className="text-[0.78125rem] text-muted">{toLabel}</span>
      {picker(to, (v) => go(from, v))}
    </div>
  )
}
