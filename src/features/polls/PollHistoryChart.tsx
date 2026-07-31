'use client'

import type { Lang } from '@/shared/i18n'
import type { PollHistoryEvent } from './queries'

// Палитра линий (различима в light/dark). Порядок = порядок вариантов опроса.
const PALETTE = ['#2563eb', '#16a34a', '#d97706', '#dc2626', '#7c3aed', '#0891b2', '#db2777', '#65a30d']

/** График динамики голосов во времени (как в Telegram): по одной накопительной
 *  линии на вариант. Резкий скачок одной линии = «вброс». Чистый SVG, без либ. */
export function PollHistoryChart({ events, options, lang }: { events: PollHistoryEvent[]; options: { id: string; text: string }[]; lang: Lang }) {
  const ru = lang === 'ru'
  if (!events.length) return <p className="py-2 text-center text-[0.78125rem] text-muted">{ru ? 'Пока нет голосов' : 'No votes yet'}</p>

  const ids = options.map((o) => o.id)
  const sorted = [...events].sort((a, b) => a.t - b.t)
  const t0 = sorted[0].t
  const t1 = sorted[sorted.length - 1].t
  const span = Math.max(1, t1 - t0)

  // Накопительные точки на вариант (step-after): горизонталь до момента + скачок.
  const cum: Record<string, number> = {}
  const series: Record<string, { x: number; y: number }[]> = {}
  ids.forEach((id) => {
    cum[id] = 0
    series[id] = [{ x: 0, y: 0 }]
  })
  let maxY = 1
  for (const e of sorted) {
    if (!(e.optionId in cum)) continue
    const x = (e.t - t0) / span
    const s = series[e.optionId]
    s.push({ x, y: cum[e.optionId] }) // горизонталь до текущего момента
    cum[e.optionId] += 1
    s.push({ x, y: cum[e.optionId] }) // вертикальный скачок
    if (cum[e.optionId] > maxY) maxY = cum[e.optionId]
  }
  ids.forEach((id) => {
    const s = series[id]
    s.push({ x: 1, y: s[s.length - 1].y }) // дотягиваем до правого края
  })

  const W = 320
  const H = 120
  const padL = 4
  const padR = 4
  const padT = 8
  const padB = 6
  const plotW = W - padL - padR
  const plotH = H - padT - padB
  const px = (x: number) => padL + x * plotW
  const py = (y: number) => padT + (1 - y / maxY) * plotH
  const toPath = (pts: { x: number; y: number }[]) => pts.map((p, i) => `${i ? 'L' : 'M'}${px(p.x).toFixed(1)},${py(p.y).toFixed(1)}`).join(' ')

  const fmt = (ms: number) => new Date(ms).toLocaleDateString(ru ? 'ru' : 'en', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

  return (
    <div className="flex flex-col gap-2">
      <div className="overflow-hidden rounded-md border border-border bg-surface-2 p-2">
        <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" preserveAspectRatio="none" role="img" aria-label={ru ? 'Динамика голосов во времени' : 'Vote dynamics over time'}>
          {/* горизонтальные направляющие */}
          {[0, 0.5, 1].map((f) => (
            <line key={f} x1={padL} x2={W - padR} y1={padT + f * plotH} y2={padT + f * plotH} stroke="var(--border)" strokeWidth={0.5} />
          ))}
          {ids.map((id, i) => (
            <path key={id} d={toPath(series[id])} fill="none" stroke={PALETTE[i % PALETTE.length]} strokeWidth={1.5} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
          ))}
        </svg>
        <div className="mt-1 flex justify-between text-[0.6875rem] text-muted">
          <span>{fmt(t0)}</span>
          <span>{fmt(t1)}</span>
        </div>
      </div>
      <ul className="flex flex-wrap gap-x-3 gap-y-1 text-[0.6875rem]">
        {options.map((o, i) => (
          <li key={o.id} className="inline-flex items-center gap-1.5 text-ink-2">
            <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: PALETTE[i % PALETTE.length] }} />
            <span className="max-w-[10rem] truncate">{o.text || `#${i + 1}`}</span>
            <span className="font-mono text-muted">{cum[o.id] ?? 0}</span>
          </li>
        ))}
      </ul>
      <p className="text-[0.6875rem] text-muted">{ru ? 'Резкий скачок одной линии может указывать на накрутку.' : 'A sharp jump in one line may indicate vote manipulation.'}</p>
    </div>
  )
}
