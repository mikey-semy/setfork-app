import { parseVideoEmbed } from './blocks'
import { safeHref } from '@/shared/lib/safe-url'

/** Безопасная встройка видео: iframe ТОЛЬКО для YouTube/Vimeo (известные src),
 *  прямой файл → <video>, иначе — ссылка. Произвольный src в iframe не пускаем. */
export function VideoEmbed({ url, caption }: { url: string; caption?: string }) {
  const { kind, src } = parseVideoEmbed(url)
  if (!src) return null
  return (
    <figure className="break-inside-avoid">
      {kind === 'youtube' || kind === 'vimeo' ? (
        <div className="relative w-full overflow-hidden rounded-lg border border-border" style={{ aspectRatio: '16 / 9' }}>
          <iframe
            src={src}
            title={caption || 'video'}
            className="absolute inset-0 h-full w-full"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            allowFullScreen
            loading="lazy"
            referrerPolicy="strict-origin-when-cross-origin"
          />
        </div>
      ) : kind === 'file' ? (
        <video src={src} controls className="max-h-130 w-full rounded-lg border border-border" />
      ) : (
        // Нераспознанный провайдер печатает сам URL — он длинный и без пробелов.
        <a href={safeHref(src) || undefined} target="_blank" rel="noreferrer" className="inline-flex min-w-0 items-center gap-1.5 text-body text-accent hover:underline [overflow-wrap:anywhere]">
          🎬 {src}
        </a>
      )}
      {caption && <figcaption className="mt-1.5 text-body-sm text-muted [overflow-wrap:anywhere]">{caption}</figcaption>}
    </figure>
  )
}
