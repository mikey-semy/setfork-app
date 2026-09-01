import { FileText, Image as ImageIcon, Info, ListChecks, ShoppingBag, UserRound, Video } from 'lucide-react'
import type { ProposedItem } from '@/shared/db'
import { t, tr, type Lang } from '@/shared/i18n'
import { CodeCard } from '@/shared/ui/CodeCard'
import { CopyRow } from '@/shared/ui/CopyRow'
import { Markdown } from '@/shared/ui/Markdown'
import { SafeLink } from '@/shared/ui/SafeLink'
import { StepLevelBadge } from '@/shared/ui/StepLevelBadge'
import { cardClass } from '@/shared/ui/card-style'
import { blockText } from './blocks'

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
/**
 * Не-step блок в предпросмотре: тип, суть и ничего лишнего.
 *
 * Раньше сюда попадал только текст (у него есть content.md), а картинка, видео,
 * файл, товары, опрос и тест проваливались в рендер ШАГА: читатель видел пустую
 * строчку с маркером и бейджем уровня, то есть предпросмотр показывал не тот
 * список, который получится после принятия.
 *
 * Показываем скромно и статично (без голосования и проверки ответов): это
 * предпросмотр, а не вторая копия страницы списка.
 */
function BlockPreview({ item, lang }: { item: ProposedItem; lang: Lang }) {
  const c = (item.content ?? {}) as Record<string, unknown>
  const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '')
  const head = (icon: React.ReactNode, text: string) => (
    <div className="flex items-center gap-2 text-body text-ink-2">
      <span className="text-muted">{icon}</span>
      <span className="min-w-0 [overflow-wrap:anywhere]">{text}</span>
    </div>
  )
  const caption = str(c.caption)
  switch (item.type) {
    case 'image':
      return head(<ImageIcon size={14} />, caption || t('blockImage', lang))
    case 'video':
      return head(<Video size={14} />, caption || str(c.url) || t('blockVideo', lang))
    case 'file':
      return head(<FileText size={14} />, str(c.fileName) || str(c.url) || t('blockFile', lang))
    case 'product': {
      const items = Array.isArray(c.items) ? (c.items as Record<string, unknown>[]) : []
      return (
        <div className="flex flex-col gap-1">
          {head(<ShoppingBag size={14} />, t('blockProduct', lang))}
          <ul className="ml-6 list-disc text-body text-ink">
            {items.slice(0, 8).map((p, k) => (
              <li key={k} className="[overflow-wrap:anywhere]">{str(p.name) || str(p.url)}</li>
            ))}
          </ul>
        </div>
      )
    }
    case 'poll':
    case 'quiz': {
      const opts = Array.isArray(c.options) ? (c.options as Record<string, unknown>[]) : []
      return (
        <div className="flex flex-col gap-1">
          {head(<ListChecks size={14} />, str(c.question) || (item.type === 'poll' ? t('blockPoll', lang) : t('blockQuiz', lang)))}
          <ul className="ml-6 list-disc text-body text-ink">
            {/* Верные ответы в предпросмотре НЕ помечаем: рецензент читает вопрос,
                а не проходит тест. */}
            {opts.slice(0, 8).map((o, k) => (
              <li key={k} className="[overflow-wrap:anywhere]">{str(o.text)}</li>
            ))}
          </ul>
        </div>
      )
    }
    default:
      return null
  }
}

export function SuggestionResult({ items, lang, ordered = true }: { items: ProposedItem[]; lang: Lang; ordered?: boolean }) {
  // Презентационные блоки (text/image/…) в нумерацию не входят — как на странице списка.
  let seq = 0
  return (
    <div className="flex flex-col gap-2">
      {items.map((it, i) => {
        const isStep = (it.type ?? 'step') === 'step'
        const num = isStep ? ++seq : 0
        const refs = (it.refs ?? []).map((r) => ({ label: tr(r.label, lang), url: r.url }))
        const md = blockText(it.content?.md, lang)
        return (
          <div key={i} className={cardClass()}>
            {!isStep && md ? (
              <Markdown>{md}</Markdown>
            ) : !isStep ? (
              <BlockPreview item={it} lang={lang} />
            ) : (
              <div className="flex gap-3">
                <span className="mt-0.5 font-mono text-body text-muted">{ordered && num ? num : '•'}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-body-lg font-semibold text-ink">{tr(it.title, lang)}</span>
                    <StepLevelBadge level={it.level} lang={lang} />
                  </div>
                  {tr(it.desc, lang) && <Markdown className="mt-1">{tr(it.desc, lang)}</Markdown>}
                  {tr(it.why, lang) && (
                    <div className="mt-1.5 flex gap-1.5 text-body-sm text-ink-2">
                      <Info size={13} className="mt-0.5 shrink-0 text-muted" />
                      <span className="min-w-0">
                        <span className="font-medium text-ink-2">{t('whyLabel', lang)}:</span> {tr(it.why, lang)}
                      </span>
                    </div>
                  )}
                  {it.needsHuman && (
                    <div className="mt-1.5 flex gap-1.5 rounded-md border border-dashed border-border bg-surface-2 px-2.5 py-2 text-body-sm text-ink-2">
                      <UserRound size={13} className="mt-0.5 shrink-0 text-muted" />
                      <span className="min-w-0">
                        <span className="font-medium text-ink-2">{t('needsHumanLabel', lang)}:</span>{' '}
                        {tr(it.needsHumanAsk ?? {}, lang) || t('needsHumanGeneric', lang)}
                      </span>
                    </div>
                  )}
                  {it.command && (
                    <>
                      {/* ⚠️ Тот же канон, что у команды шага (ListStepCard): на ЭКРАНЕ —
                          прокрутка и кнопка копирования, на ПЕЧАТИ — CodeCard, потому что
                          прокрутки на бумаге нет и всё правее видимой ширины пропадёт.
                          Предложенную команду копируют чаще, чем читают: она приехала,
                          чтобы её выполнить. */}
                      <CopyRow
                        value={it.command}
                        lang={lang}
                        prompt
                        className="mt-3 print:hidden"
                      />
                      <div className="mt-3 hidden print:block">
                        <CodeCard code={it.command} name="bash" lang={lang} />
                      </div>
                    </>
                  )}
                  {(it.subtasks ?? []).length > 0 && (
                    <ul className="mt-2 flex flex-col gap-1">
                      {(it.subtasks ?? []).map((s, si) => (
                        <li key={si} className="flex gap-1.5 text-body-sm text-ink-2">
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
                          <SafeLink key={ri} href={r.url} className="text-body-sm text-ink-2 underline decoration-dotted hover:text-ink">
                            {r.label || r.url}
                          </SafeLink>
                        ) : (
                          <span key={ri} className="text-body-sm text-muted">
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
