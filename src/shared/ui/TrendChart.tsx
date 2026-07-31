// Переиспользуемый мини-график тренда (SVG area, server-safe — без клиентского JS).
// Используется Insights списка; подходит для профилей/админки. Цвет — токен темы.

const COLORS = {
  accent: 'var(--accent)',
  ok: 'var(--ok)',
  warn: 'var(--warn)',
  cur: 'var(--cur)',
} as const

export function TrendChart({
  points,
  color = 'accent',
  height = 120,
  labels,
  className,
}: {
  points: number[]
  color?: keyof typeof COLORS
  height?: number
  /** Подписи оси X (обычно первая/последняя неделя). */
  labels?: [string, string]
  className?: string
}) {
  const W = 600
  const H = height
  const PAD = 6
  const max = Math.max(1, ...points)
  const n = Math.max(2, points.length)
  const x = (i: number) => PAD + (i * (W - PAD * 2)) / (n - 1)
  const y = (v: number) => H - PAD - (v / max) * (H - PAD * 2)
  const line = points.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ')
  const area = `${PAD},${H - PAD} ${line} ${x(points.length - 1).toFixed(1)},${H - PAD}`
  const stroke = COLORS[color]
  const total = points.reduce((s, v) => s + v, 0)

  return (
    <div className={`min-w-0 ${className ?? ''}`}>
      {/* Без width/height-атрибутов: они задают SVG max-content = 600px, и в сжимаемой
          колонке всё равно норм, но в неявном grid-треке `auto` это тянет вёрстку за
          экран. viewBox + w-full + max-w-full + h-auto → масштаб по ширине контейнера,
          высота по соотношению сторон (реальный фикс ширины — grid-cols-1 у сеток). */}
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="xMidYMid meet"
        className="block h-auto w-full max-w-full"
        role="img"
        aria-label={`trend, total ${total}`}
      >
        {/* фоновая сетка: 3 горизонтали */}
        {[0.25, 0.5, 0.75].map((f) => (
          <line key={f} x1={PAD} x2={W - PAD} y1={PAD + f * (H - PAD * 2)} y2={PAD + f * (H - PAD * 2)} stroke="var(--border)" strokeWidth="1" strokeDasharray="3 5" />
        ))}
        <polygon points={area} fill={stroke} opacity="0.12" />
        <polyline points={line} fill="none" stroke={stroke} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        {/* последняя точка — акцент */}
        <circle cx={x(points.length - 1)} cy={y(points[points.length - 1] ?? 0)} r="3.5" fill={stroke} />
      </svg>
      {labels && (
        <div className="mt-1 flex justify-between font-mono text-[11px] text-muted">
          <span>{labels[0]}</span>
          <span>{labels[1]}</span>
        </div>
      )}
    </div>
  )
}
