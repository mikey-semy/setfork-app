// Детерминированный «честный» авто-баннер (когда у списка/коллекции нет обложки):
// мягкий accent-градиент по seed/accent + компактная монограмма-чип вместо крупной
// буквы-заглушки. Без внешних ресурсов — чистый CSS. Тот же accent карточки берут
// для полосы слева (cardAccent), так что список узнаётся и в ленте, и в Explore.
function hashHue(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0
  return Math.abs(h) % 360
}

/** Стабильный accent карточки: заданный hex либо детерминированный оттенок по seed. */
export function cardAccent(accent: string | null | undefined, seed: string): string {
  return accent && /^#[0-9a-fA-F]{6}$/.test(accent) ? accent : `hsl(${hashHue(seed)} 55% 46%)`
}

function monogram(s: string): string {
  return s.replace(/[^a-zA-Z0-9]/g, '').slice(0, 2).toUpperCase() || 'SF'
}

export function AutoBanner({
  seed,
  accent,
  label,
  className = '',
  height = 'h-[7.5rem]',
}: {
  seed: string
  accent?: string | null
  label?: string
  className?: string
  height?: string
}) {
  const a = cardAccent(accent, seed)
  const mono = monogram(label ?? seed)
  return (
    <div
      className={`relative overflow-hidden ${height} ${className}`}
      style={{
        background: `radial-gradient(120% 120% at 100% 0, color-mix(in srgb, ${a} 42%, transparent), transparent 60%), repeating-linear-gradient(-45deg, color-mix(in srgb, ${a} 14%, transparent) 0 2px, transparent 2px 9px), linear-gradient(135deg, color-mix(in srgb, ${a} 20%, var(--surface)), var(--surface))`,
      }}
    >
      <span
        className="absolute right-2.5 bottom-2 rounded-md border px-2 py-0.5 text-[0.78125rem] leading-none font-extrabold tracking-wide uppercase"
        style={{ color: a, background: 'var(--surface)', borderColor: `color-mix(in srgb, ${a} 40%, var(--border))` }}
      >
        {mono}
      </span>
    </div>
  )
}
