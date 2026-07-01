import { identiconCells } from '@/shared/lib/identicon'

export function Identicon({ seed, color, size = 38 }: { seed: string; color: string; size?: number }) {
  const cells = identiconCells(seed)
  return (
    <div
      style={{ width: size, height: size, padding: size * 0.13 }}
      className="grid flex-shrink-0 grid-cols-5 grid-rows-5 gap-px rounded-md bg-[var(--border)]"
    >
      {cells.map((on, i) => (
        <span key={i} style={{ background: on ? color : 'transparent', borderRadius: 1 }} />
      ))}
    </div>
  )
}
