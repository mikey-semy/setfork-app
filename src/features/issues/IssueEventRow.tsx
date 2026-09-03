import Link from 'next/link'
import { CircleDot, CircleCheckBig, GitMerge, Lock, LockOpen } from 'lucide-react'
import { fill, t, type Lang, type TKey } from '@/shared/i18n'
import { Avatar } from '@/shared/ui/Avatar'
import type { IssueEvent } from './events'

/**
 * СТРОКА СОБЫТИЯ В ЛЕНТЕ ЗАДАЧИ.
 *
 * Не карточка: событие — это одна фраза («закрыл задачу», «закрыта правкой №7»), и
 * карточка с рамкой и отступами ставила бы её вровень с репликой, у которой есть текст,
 * правки и реакции. Так же в GitHub и Gitea: реплики — карточками, события — строкой с
 * кружком.
 */
const KIND: Record<IssueEvent['kind'], { icon: typeof CircleDot; tone: string; label: TKey }> = {
  closed: { icon: CircleCheckBig, tone: 'text-danger', label: 'issue.eventClosed' },
  reopened: { icon: CircleDot, tone: 'text-ok', label: 'issue.eventReopened' },
  closed_by_suggestion: { icon: GitMerge, tone: 'text-accent', label: 'issue.eventClosedBySuggestion' },
  locked: { icon: Lock, tone: 'text-warn', label: 'issue.eventLocked' },
  unlocked: { icon: LockOpen, tone: 'text-ink-2', label: 'issue.eventUnlocked' },
}

export function IssueEventRow({ event, listPath, lang }: { event: IssueEvent; listPath: string; lang: Lang }) {
  const spec = KIND[event.kind]
  const Icon = spec.icon
  const number = event.suggestion?.number
  return (
    <div className="flex min-w-0 items-center gap-2 px-1 py-1 text-body-sm text-ink-2">
      <Icon size={16} className={`shrink-0 ${spec.tone}`} />
      <Avatar handle={event.actorHandle} avatarUrl={event.actorAvatarUrl} size={20} />
      <span className="min-w-0 [overflow-wrap:anywhere]">
        <Link href={`/${event.actorHandle}`} className="font-medium text-ink hover:underline">
          {event.actorHandle}
        </Link>{' '}
        {event.kind === 'closed_by_suggestion' && event.suggestion ? (
          <>
            {t('issue.eventClosedBy', lang)}{' '}
            <Link href={`${listPath}/suggestions/${event.suggestion.id}`} className="text-accent hover:underline">
              {/* Номер — то, чем правку зовут люди. Его может не быть у самых старых
                  записей: тогда показываем общее слово, а ссылка всё равно ведёт куда надо. */}
              {number ? fill('issue.suggestionNumber', lang, { n: String(number) }) : t('issue.suggestionOne', lang)}
            </Link>
          </>
        ) : event.kind === 'locked' && event.lockReason ? (
          // Причина названа прямо в ленте: «запер обсуждение» без причины читается как
          // произвол, а причина — это ответ на вопрос «за что».
          <>
            {t('issue.eventLockedAs', lang)} <span className="font-medium text-ink">{t(`issue.lockReason.${event.lockReason}` as TKey, lang)}</span>
          </>
        ) : (
          t(spec.label, lang)
        )}
      </span>
      <time dateTime={event.createdAt.toISOString()} className="ml-auto shrink-0 text-caption text-muted">
        {new Intl.DateTimeFormat(lang === 'ru' ? 'ru' : 'en', { day: 'numeric', month: 'short' }).format(event.createdAt)}
      </time>
    </div>
  )
}
