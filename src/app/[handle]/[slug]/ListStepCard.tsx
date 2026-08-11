import Link from 'next/link'
import { ExternalLink, Info, SquareCheckBig, UserRound } from 'lucide-react'
import { DigChatOpen } from '@/features/dig/DigChat'
import { CopyButton } from '@/shared/ui/CopyButton'
import { Markdown } from '@/shared/ui/Markdown'
import { SafeLink } from '@/shared/ui/SafeLink'
import { SmartImage } from '@/shared/ui/SmartImage'
import { StepDangerBadge, StepLevelBadge } from '@/shared/ui/StepLevelBadge'
import { linkLabel } from '@/shared/lib/link-label'
import { renderWikiLinks } from '@/shared/lib/wiki-links'
import { t, tr, type Lang, type LocaleText } from '@/shared/i18n'
import type { ListPageData } from './load'

type Props = Pick<ListPageData, 'tpl' | 'base' | 'viewer' | 'readOnlyView' | 'isOwner' | 'digSteps' | 'stepImages' | 'mon'> & {
  step: ListPageData['steps'][number]
  /** Порядковый номер в нумерованном списке; у ненумерованного — точка. */
  number: string
  lang: Lang
}

/**
 * Карточка шага: заголовок с бейджами, описание, «зачем», приглашение человеку,
 * скриншот, команда, проверки и ссылки. Одна причина менять этот файл — состав полей
 * шага; блоки другого вида живут в [ListBlock.tsx](./ListBlock.tsx).
 */
export function ListStepCard({ step, number, tpl, base, viewer, readOnlyView, isOwner, digSteps, stepImages, mon, lang }: Props) {
  const subs = (step.subtasks as LocaleText[]).map((x) => tr(x, lang)).filter(Boolean)
  // href — через /api/go (журнал кликов), если трекинг включён в админке;
  // у веток snapshot-шаги без DB-id → прямой url. Экспорт/MD не трогаем.
  const refs = (step.refs as { label: LocaleText; url?: string }[]).map((x, ri) => ({
    label: tr(x.label, lang),
    url: x.url,
    href: x.url && !readOnlyView && mon.linkTracking ? `/api/go/${step.id}/${ri}` : x.url,
  }))
  const desc = tr(step.desc, lang)
  const why = tr(step.why, lang)

  return (
    <div className="relative break-inside-avoid rounded-lg border border-border bg-surface p-4">
      {/* Кирка — СТРОГО в правом верхнем углу карточки (absolute, не в потоке:
          при переносе заголовка она уплывала в середину — фидбек владельца). */}
      {viewer && !readOnlyView && typeof step.n === 'number' && (
        <span className="absolute right-2 top-2 print:hidden">
          <DigChatOpen detail={{ templateId: tpl.id, stepN: step.n, stepTitle: tr(step.title, lang) }} label={t('list.digIntoStep', lang)} hasSession={digSteps.has(step.n)} />
        </span>
      )}
      <div className="flex gap-3">
        <span className="mt-0.5 font-mono text-[0.8125rem] text-muted">{number}</span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2 pr-7">
            {/* Заголовок шага пишет человек: слово без пробелов иначе уезжает
                за правый край и тянет за собой страницу (мобила 390px). */}
            <span className="min-w-0 text-[0.875rem] font-semibold text-ink [overflow-wrap:anywhere]">{tr(step.title, lang)}</span>
            <StepLevelBadge level={step.level} lang={lang} />
            {/* Разрушительный пункт виден ДО того, как его скопировали
                в терминал, — на сайте, а не только в скрипте. */}
            <StepDangerBadge step={step} lang={lang} />
          </div>
          {desc && <Markdown className="mt-1">{renderWikiLinks(desc)}</Markdown>}
          {why && (
            <div className="mt-1.5 flex gap-1.5 text-[0.78125rem] text-ink-2">
              <Info size={13} className="mt-0.5 shrink-0 text-muted" />
              <span className="min-w-0 [overflow-wrap:anywhere]">
                <span className="font-medium text-ink-2">{t('whyLabel', lang)}:</span> {why}
              </span>
            </div>
          )}
          {/* «ЗДЕСЬ НУЖЕН ЧЕЛОВЕК»: место, где машина честно не знает —
              местные цены, вкус, время на вашем оборудовании. Не дефект, а
              приглашение: реальный опыт доступен человеку, не модели.
              Приглашение ведёт в тот же поток правки, что и кнопка сверху. */}
          {step.needsHuman && (
            <div className="mt-1.5 flex gap-1.5 rounded-md border border-dashed border-border bg-surface-2 px-2.5 py-2 text-[0.78125rem] text-ink-2">
              <UserRound size={13} className="mt-0.5 shrink-0 text-muted" />
              <span className="min-w-0 [overflow-wrap:anywhere]">
                <span className="font-medium text-ink-2">{t('needsHumanLabel', lang)}:</span>{' '}
                {tr(step.needsHumanAsk, lang) || t('needsHumanGeneric', lang)}
                {!readOnlyView && (
                  <>
                    {' '}
                    <Link href={isOwner ? `${base}/edit` : `${base}/suggest`} className="underline decoration-dotted hover:text-ink">
                      {t('needsHumanAnswer', lang)}
                    </Link>
                  </>
                )}
              </span>
            </div>
          )}
          {stepImages[step.id] && (
            <SmartImage
              src={stepImages[step.id]}
              alt={t('screenshot', lang)}
              className="mt-3 max-h-[26.25rem] w-auto rounded-lg border border-border"
            />
          )}
          {step.command && (
            <div className="mt-3 flex items-center gap-2.5 rounded-md border border-border bg-surface-2 px-3 py-2.5 font-mono text-[0.78125rem] text-ink">
              <span className="shrink-0" style={{ color: 'var(--accent)' }}>$</span>
              {/* Горизонтальный скролл + выделение: можно доскроллить до конца строки
                  и выделить/скопировать её часть, а не только всю через кнопку. */}
              <span className="no-scrollbar min-w-0 flex-1 select-text overflow-x-auto whitespace-nowrap">{step.command}</span>
              <CopyButton text={step.command} lang={lang} />
            </div>
          )}
          {subs.length > 0 && (
            <div className="mt-3">
              {/* subtasks — критерии проверки шага (см. промпт генерации:
                  «verification checks»), а не под-шаги: подписываем и рисуем
                  чек-квадратами, иначе выглядят оторванным списком. */}
              <div className="mb-1 text-[0.6875rem] font-semibold uppercase tracking-wide text-muted">
                {t('stepChecksLabel', lang)}
              </div>
              <ul className="flex flex-col gap-1.5">
                {/* Ключ по тексту проверки, а не по индексу: при правке шага
                    список пересобирается, и индексные ключи путают строки. */}
                {subs.map((label, i) => (
                  <li key={`${label}#${i}`} className="flex gap-2 text-[0.8125rem] text-ink-2 [overflow-wrap:anywhere]">
                    <SquareCheckBig size={14} className="mt-0.5 shrink-0 text-muted" />
                    {label}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {refs.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {refs.map((r) => {
                // Подпись ссылки нередко и есть URL — без переноса чип уносит страницу.
                const cls =
                  'inline-flex min-w-0 items-center gap-1 rounded-md border border-border bg-surface-2 px-2.5 py-1 text-[0.6875rem] text-accent [overflow-wrap:anywhere]'
                // Подписи может не быть (ссылку кладут одним url) — показываем домен.
                const text = linkLabel(r.label, r.url)
                return r.url ? (
                  <SafeLink key={`${r.label}:${r.url}`} href={r.href ?? r.url} rel="nofollow noreferrer" className={cls}>
                    <ExternalLink size={11} /> {text}
                  </SafeLink>
                ) : (
                  <span key={`${r.label}:`} className={cls}>
                    <ExternalLink size={11} /> {text}
                  </span>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
