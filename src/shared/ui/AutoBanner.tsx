// Детерминированный авто-баннер (когда у списка нет обложки): градиент по seed
// или заданному акценту + крупная приглушённая монограмма из slug. Без внешних
// ресурсов — чистый CSS-градиент.
function hashHue(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0
  return Math.abs(h) % 360
}

export function AutoBanner({
  seed,
  accent,
  label,
  className = '',
  height = 'h-[120px]',
}: {
  seed: string
  accent?: string | null
  label?: string
  className?: string
  height?: string
}) {
  const h1 = hashHue(seed)
  const h2 = (h1 + 42) % 360
  const bg =
    accent && /^#[0-9a-fA-F]{6}$/.test(accent)
      ? `linear-gradient(135deg, ${accent}, #0b0d12)`
      : `linear-gradient(135deg, hsl(${h1} 68% 40%), hsl(${h2} 60% 24%))`
  const mono = (label ?? seed).replace(/[^a-zA-Z0-9]/g, '').slice(0, 2).toUpperCase() || 'SF'
  return (
    <div className={`relative flex items-center justify-center overflow-hidden ${height} ${className}`} style={{ background: bg }}>
      <span className="font-logo select-none text-[52px] font-bold uppercase leading-none tracking-tight text-white/25">{mono}</span>
    </div>
  )
}
