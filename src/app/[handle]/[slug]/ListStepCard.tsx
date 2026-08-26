import Link from 'next/link'
import { ExternalLink, Info, SquareCheckBig, UserRound } from 'lucide-react'
import { DigChatOpen } from '@/features/dig/DigChat'
import { CopyRow } from '@/shared/ui/CopyRow'
import { splitOrdinal } from '@/shared/lib/ordinal'
import { CodeCard } from '@/shared/ui/CodeCard'
import { Markdown } from '@/shared/ui/Markdown'
import { SafeLink } from '@/shared/ui/SafeLink'
import { SmartImage } from '@/shared/ui/SmartImage'
import { StepDangerBadge, StepLevelBadge } from '@/shared/ui/StepLevelBadge'
import { linkLabel } from '@/shared/lib/link-label'
import { renderWikiLinks } from '@/shared/lib/wiki-links'
import { t, tr, type Lang, type LocaleText } from '@/shared/i18n'
import type { ListPageData } from './load'
import { cardClass } from '@/shared/ui/card-style'

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
  // flatMap, а не map().filter(Boolean): один проход, пустой перевод отсеивается сразу.
  const subs = (step.subtasks as LocaleText[]).flatMap((x) => tr(x, lang) || [])
  // href — через /api/go (журнал кликов), если трекинг включён в админке;
  // у веток snapshot-шаги без DB-id → прямой url. Экспорт/MD не трогаем.
  const refs = (step.refs as { label: LocaleText; url?: string }[]).map((x, ri) => ({
    label: tr(x.label, lang),
    url: x.url,
    href: x.url && !readOnlyView && mon.linkTracking ? `/api/go/${step.id}/${ri}` : x.url,
  }))
  const desc = tr(step.desc, lang)
  const why = tr(step.why, lang)
  // Автор пронумеровал заголовок сам — его номер идёт в колонку номера вместо нашего.
  // Иначе дубль: «1» слева и «1. Проверить связь» рядом. Новые списки такого номера уже
  // не получают (снимается на записи), но у созданных раньше он лежит в тексте, и без
  // этого его не убрать. Многоуровневую нумерацию интерфейс не рисует — она остаётся.
  const { num: titleNum, text: titleText } = splitOrdinal(tr(step.title, lang))

  return (
    <div className={cardClass({ className: `relative break-inside-avoid${step.command ? ' print:break-inside-auto' : ''}` })}>
      {/* Кирка — СТРОГО в правом верхнем углу карточки (absolute, не в потоке:
          при переносе заголовка она уплывала в середину — фидбек владельца). */}
      {viewer && !readOnlyView && typeof step.n === 'number' && (
        <span className="absolute right-2 top-2 print:hidden">
          <DigChatOpen detail={{ templateId: tpl.id, stepN: step.n, stepTitle: tr(step.title, lang) }} label={t('list.digIntoStep', lang)} hasSession={digSteps.has(step.n)} />
        </span>
      )}
      <div className="flex gap-3">
        <span className="mt-0.5 font-mono text-body text-muted">{titleNum ?? number}</span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2 pr-7">
            {/* Заголовок шага пишет человек: слово без пробелов иначе уезжает
                за правый край и тянет за собой страницу (мобила 390px). */}
            <span className="min-w-0 text-body-lg font-semibold text-ink [overflow-wrap:anywhere]">{titleText}</span>
            <StepLevelBadge level={step.level} lang={lang} />
            {/* Разрушительный пункт виден ДО того, как его скопировали
                в терминал, — на сайте, а не только в скрипте. */}
            <StepDangerBadge step={step} lang={lang} />
          </div>
          {desc && <Markdown className="mt-1">{renderWikiLinks(desc)}</Markdown>}
          {why && (
            <div className="mt-1.5 flex gap-1.5 text-body-sm text-ink-2">
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
            <div className="mt-1.5 flex gap-1.5 rounded-md border border-dashed border-border bg-surface-2 px-2.5 py-2 text-body-sm text-ink-2">
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
            <>
              {/* На экране команда остаётся компактной и прокручиваемой. Печать этого
                  контейнера обрезала всё правее видимой области, поэтому принтер его
                  не видит — ниже для него полноценная CodeCard. */}
              <CopyRow value={step.command} lang={lang} prompt className="mt-3 print:hidden" />
              {/* Команда — shell-код по контракту списка. CodeCard печатает каждую
                  строку целиком, с номером и highlight.js-подсветкой. */}
              <div className="mt-3 hidden print:block">
                <CodeCard code={step.command} name="bash" lang={lang} />
              </div>
            </>
          )}
          {subs.length > 0 && (
            <div className="mt-3">
              {/* subtasks — критерии проверки шага (см. промпт генерации:
                  «verification checks»), а не под-шаги: подписываем и рисуем
                  чек-квадратами, иначе выглядят оторванным списком. */}
              <div className="mb-1 text-caption font-semibold uppercase tracking-wide text-muted">
                {t('stepChecksLabel', lang)}
              </div>
              <ul className="flex flex-col gap-1.5">
                {/* Ключ по тексту проверки, а не по индексу: при правке шага
                    список пересобирается, и индексные ключи путают строки. */}
                {subs.map((label, i) => (
                  <li key={`${label}#${i}`} className="flex gap-2 text-body text-ink-2 [overflow-wrap:anywhere]">
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
                  'inline-flex min-w-0 items-center gap-1 rounded-md border border-border bg-surface-2 px-2.5 py-1 text-caption text-accent [overflow-wrap:anywhere]'
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
