'use client'

import { useRouter } from 'next/navigation'
import { ArrowRight } from 'lucide-react'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select'

// Выбор пары версий (shadcn Select) — масштабируется на десятки/сотни версий.
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

  const picker = (value: number, onPick: (v: number) => void) => (
    <Select value={String(value)} onValueChange={(v) => onPick(Number(v))}>
      <SelectTrigger className="h-8 w-[92px] font-mono text-[13px]">
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
      <span className="text-[12px] text-muted">{fromLabel}</span>
      {picker(from, (v) => go(v, to))}
      <ArrowRight size={14} className="text-muted" />
      <span className="text-[12px] text-muted">{toLabel}</span>
      {picker(to, (v) => go(from, v))}
    </div>
  )
}
