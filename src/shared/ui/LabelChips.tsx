import type { Lang } from '@/shared/i18n'
import { resolveChip, type CustomLabel } from '@/shared/lib/labels'

export function LabelChips({ labels, lang, custom = [] }: { labels: string[]; lang: Lang; custom?: CustomLabel[] }) {
  if (!labels.length) return null
  return (
    <>
      {labels.map((k) => {
        const c = resolveChip(k, custom, lang)
        return (
          <span
            key={k}
            style={c.style}
            className={`rounded-full border px-2 py-0.5 text-[0.6875rem] font-medium ${c.cls ?? (c.style ? '' : 'border-border text-ink-2')}`}
          >
            {c.text}
          </span>
        )
      })}
    </>
  )
}
