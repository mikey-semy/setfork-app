import { Info, UserRound } from 'lucide-react'
import type { ProposedItem } from '@/shared/db'
import { t, tr, type Lang } from '@/shared/i18n'
import { CodeCard } from '@/shared/ui/CodeCard'
import { Markdown } from '@/shared/ui/Markdown'
import { SafeLink } from '@/shared/ui/SafeLink'
import { StepLevelBadge } from '@/shared/ui/StepLevelBadge'

/**
 * ИТОГ ПРАВКИ — как список будет выглядеть, ЕСЛИ её принять.
 *
 * Зачем отдельно от диффа: дифф отвечает «что изменилось», а решение принимается по другому
 * вопросу — «каким станет список». Читать его по плюсам и минусам можно, но это работа
 * глазами, и именно поэтому правки от компании копились непринятыми: посмотреть результат
 * было негде. Здесь он показан так, как увидит читатель.
 *
 * Рендер намеренно СКРОМНЕЕ страницы списка (без прогонов, комментариев, кирки): это
 * предпросмотр, а не вторая копия страницы, которая разъедется с оригиналом.
 */
export function SuggestionResult({ items, lang, ordered = true }: { items: ProposedItem[]; lang: Lang; ordered?: boolean }) {
  // Презентационные блоки (text/image/…) в нумерацию не входят — как на странице списка.
  let seq = 0
  return (
    <div className="flex flex-col gap-2">
      {items.map((it, i) => {
        const isStep = (it.type ?? 'step') === 'step'
        const num = isStep ? ++seq : 0
        const refs = (it.refs ?? []).map((r) => ({ label: tr(r.label, lang), url: r.url }))
        const md = typeof it.content?.md === 'string' ? it.content.md : ''
        return (
          <div key={i} className="rounded-lg border border-border bg-surface p-4">
            {!isStep && md ? (
              <Markdown>{md}</Markdown>
            ) : (
              <div className="flex gap-3">
                <span className="mt-0.5 font-mono text-[13px] text-muted">{ordered && num ? num : '•'}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[14.5px] font-semibold text-ink">{tr(it.title, lang)}</span>
                    <StepLevelBadge level={it.level} lang={lang} />
                  </div>
                  {tr(it.desc, lang) && <Markdown className="mt-1">{tr(it.desc, lang)}</Markdown>}
                  {tr(it.why, lang) && (
                    <div className="mt-1.5 flex gap-1.5 text-[12.5px] text-ink-2">
                      <Info size={13} className="mt-0.5 shrink-0 text-muted" />
                      <span className="min-w-0">
                        <span className="font-medium text-ink-2">{t('whyLabel', lang)}:</span> {tr(it.why, lang)}
                      </span>
                    </div>
                  )}
                  {it.needsHuman && (
                    <div className="mt-1.5 flex gap-1.5 rounded-md border border-dashed border-border bg-surface-2 px-2.5 py-2 text-[12.5px] text-ink-2">
                      <UserRound size={13} className="mt-0.5 shrink-0 text-muted" />
                      <span className="min-w-0">
                        <span className="font-medium text-ink-2">{t('needsHumanLabel', lang)}:</span>{' '}
                        {tr(it.needsHumanAsk ?? {}, lang) || t('needsHumanGeneric', lang)}
                      </span>
                    </div>
                  )}
                  {it.command && (
                    <div className="mt-3">
                      <CodeCard code={it.command} />
                    </div>
                  )}
                  {(it.subtasks ?? []).length > 0 && (
                    <ul className="mt-2 flex flex-col gap-1">
                      {(it.subtasks ?? []).map((s, si) => (
                        <li key={si} className="flex gap-1.5 text-[12.5px] text-ink-2">
                          <span className="text-muted">–</span>
                          <span className="min-w-0">{tr(s, lang)}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                  {refs.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
                      {refs.map((r, ri) =>
                        r.url ? (
                          <SafeLink key={ri} href={r.url} className="text-[12.5px] text-ink-2 underline decoration-dotted hover:text-ink">
                            {r.label || r.url}
                          </SafeLink>
                        ) : (
                          <span key={ri} className="text-[12.5px] text-muted">
                            {r.label}
                          </span>
                        ),
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
