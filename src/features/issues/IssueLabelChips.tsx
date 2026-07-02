import type { Lang } from '@/shared/i18n'
import { labelMeta, labelText } from './labels'

export function IssueLabelChips({ labels, lang }: { labels: string[]; lang: Lang }) {
  if (!labels.length) return null
  return (
    <>
      {labels.map((k) => {
        const m = labelMeta(k)
        return (
          <span key={k} className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${m?.cls ?? 'border-border text-ink-2'}`}>
            {labelText(k, lang)}
          </span>
        )
      })}
    </>
  )
}
