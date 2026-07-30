import { Avatar } from './Avatar'

/**
 * КОЛОДА АВАТАРОК — несколько человек в одну строку внахлёст (как у GitHub в строке
 * последнего коммита: «mikey-semy and claude» с двумя аватарами).
 *
 * Зачем отдельным примитивом: у версии списка может быть не один автор (правку
 * принимают с соавторами), и раскладывать их в ряд полноразмерными аватарами — это
 * съеденная ширина на узком экране. Внахлёст читается как «эти люди вместе», занимает
 * место одного с хвостиком, а лишние сворачиваются в «+N».
 *
 * Кольцо цветом подложки (`ring-surface`) — не украшение: без него соседние аватары
 * сливаются в кашу, потому что перекрываются.
 */
export function AvatarStack({
  people,
  size = 20,
  max = 3,
  className = '',
}: {
  people: { handle: string; avatarUrl?: string | null }[]
  size?: number
  /** Сколько показываем до сворачивания в «+N». */
  max?: number
  className?: string
}) {
  if (!people.length) return null
  const shown = people.slice(0, max)
  const rest = people.length - shown.length
  return (
    <span className={`inline-flex shrink-0 items-center ${className}`}>
      {shown.map((p) => (
        <span key={p.handle} className="-ml-1.5 first:ml-0 rounded-full ring-2 ring-surface">
          <Avatar handle={p.handle} avatarUrl={p.avatarUrl} size={size} />
        </span>
      ))}
      {rest > 0 && (
        <span
          className="-ml-1.5 grid place-items-center rounded-full bg-surface-2 font-mono text-[10px] font-semibold text-ink-2 ring-2 ring-surface"
          style={{ width: size, height: size }}
        >
          {`+${rest}`}
        </span>
      )}
    </span>
  )
}
