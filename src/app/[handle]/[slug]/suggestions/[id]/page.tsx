import { getSession } from '@/shared/auth/session'
import { getLang } from '@/shared/i18n/server'
import { t } from '@/shared/i18n'
import { PAGE } from '@/shared/ui/control'
import { ChecksList } from '@/features/library/ChecksList'
import { SuggestionResult } from '@/features/library/SuggestionResult'
import { SuggestionTabs } from '@/features/library/SuggestionTabs'
import { loadSuggestionPage } from './load'
import { SuggestionAside } from './SuggestionAside'
import { SuggestionCommits } from './SuggestionCommits'
import { SuggestionConversation } from './SuggestionConversation'
import { SuggestionFiles } from './SuggestionFiles'
import { SuggestionHeader } from './SuggestionHeader'
import { SuggestionNotices } from './SuggestionNotices'
import { SuggestionReview } from './SuggestionReview'

export async function generateMetadata({ params }: { params: Promise<{ handle: string; slug: string; id: string }> }) {
  const [{ handle, slug }, lang] = await Promise.all([params, getLang()])
  return { title: `${t('suggestionHeading', lang)} · ${handle}/${slug}` }
}

/**
 * Страница предложения. Здесь только состав: шапка, плашки о судьбе правки, вкладки и
 * боковая колонка. Что показывать — решено в [load.ts](./load.ts), как выглядит каждая
 * вкладка — в соседних `Suggestion*.tsx`.
 */
export default async function SuggestionThreadPage({
  params,
  searchParams,
}: {
  params: Promise<{ handle: string; slug: string; id: string }>
  searchParams: Promise<{ e?: string; tab?: string; view?: string; commit?: string }>
}) {
  const [{ handle: owner, slug, id }, sp, lang, session] = await Promise.all([params, searchParams, getLang(), getSession()])
  const loaded = await loadSuggestionPage({ owner, slug, id, sp, lang, session })
  const { meta, path, tab, items, threadCount, changedCount, checksFailed, commits } = loaded
  const viewerId = session?.userId

  // Одна панель ревью на две вкладки — см. SuggestionReview.
  const reviewPanel = <SuggestionReview lang={lang} viewerId={viewerId} data={loaded} />

  return (
    <div className={PAGE}>
      <SuggestionHeader owner={owner} slug={slug} lang={lang} viewerId={viewerId} data={loaded} />

      <SuggestionTabs
        path={path}
        active={tab}
        conversationCount={threadCount}
        commitsCount={commits ? commits.length : null}
        filesCount={changedCount}
        checksFailed={checksFailed}
        labels={{
          conversation: t('conversationTab', lang),
          commits: t('versionsTab', lang),
          checks: t('checksTab', lang),
          files: t('proposedChanges', lang),
          result: t('resultTab', lang),
        }}
        arrows={{ prev: t('scrollPrev', lang), next: t('scrollNext', lang) }}
      />

      {/* Две колонки: содержимое вкладки + боковая панель (общий примитив). */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
        <div className="min-w-0 flex-1">
          <SuggestionNotices owner={owner} slug={slug} lang={lang} data={loaded} />

          {tab === 'commits' && <SuggestionCommits owner={owner} slug={slug} lang={lang} data={loaded} />}

          {tab === 'checks' && (
            <ChecksList items={loaded.checks} labels={{ blocking: t('checksBlocking', lang), allGood: t('checksAllGood', lang), details: t('checksDetails', lang) }} />
          )}

          {tab === 'files' && <SuggestionFiles owner={owner} slug={slug} lang={lang} viewerId={viewerId} data={loaded} reviewPanel={reviewPanel} />}

          {/* ИТОГ: каким станет список, если предложение принять. Решение принимают по
              результату, а не по плюсам и минусам — именно поэтому предложения от
              компании копились непринятыми: посмотреть результат было негде. */}
          {tab === 'result' && (
            <>
              <div className="mb-1.5 text-caption font-semibold uppercase tracking-[0.07em] text-muted">
                {t('resultTab', lang)} · {t('pr.becomesV', lang).replace('{v}', String(meta.currentVersion + 1))}
              </div>
              <SuggestionResult items={items} lang={lang} ordered={meta.ordered} />
            </>
          )}

          {/* Обсуждение — вкладка по умолчанию. Заметка правки и ревью видны здесь,
              чтобы разговор шёл при полном контексте, как в Conversation у GitHub. */}
          {tab === 'conversation' && (
            <SuggestionConversation owner={owner} slug={slug} lang={lang} session={session} data={loaded} reviewPanel={reviewPanel} />
          )}
        </div>

        <SuggestionAside owner={owner} slug={slug} lang={lang} session={session} data={loaded} />
      </div>
    </div>
  )
}
