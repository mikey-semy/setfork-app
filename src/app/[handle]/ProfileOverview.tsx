import Link from 'next/link'
import { Award, GraduationCap, Pin } from 'lucide-react'
import { t, tr, type LocaleText } from '@/shared/i18n'
import { ActivitySection } from '@/features/profile/activity/ActivitySection'
import { PinsPicker } from '@/features/profile/PinsPicker'
import { dayMonthYear } from '@/shared/lib/date'
import type { ProfilePageData } from './load'
import { buttonClass } from '@/shared/ui/button-style'

type Props = Pick<
  ProfilePageData,
  | 'handle'
  | 'lang'
  | 'isOwner'
  | 'agent'
  | 'pinned'
  | 'ownLight'
  | 'completions'
  | 'contributions'
  | 'received'
  | 'graphYear'
  | 'graphYears'
  | 'todayKey'
  | 'monthKey'
  | 'monthTopics'
  | 'activityNav'
>

/**
 * Вкладка «Обзор»: зона ответственности служебного участника, закреплённые списки,
 * пройденные курсы, граф активности и лента вкладов за месяц.
 */
export function ProfileOverview({
  handle,
  lang,
  isOwner,
  agent,
  pinned,
  ownLight,
  completions,
  contributions,
  received,
  graphYear,
  graphYears,
  todayKey,
  monthKey,
  monthTopics,
  activityNav,
}: Props) {
  return (
    <>
      {/* ЗОНА ОТВЕТСТВЕННОСТИ служебного участника: за какие темы он отвечает.
          Именно «ведёт», а не владеет — авторство чужих списков не переписываем.
          Заодно объясняет посетителю, почему правки к этим спискам идут от него. */}
      {agent && agent.tended.length > 0 && (
        <div className="mb-6 min-w-0">
          <div className="mb-2 text-[0.78125rem] font-semibold text-ink-2">{t('list.tendsTheseLists', lang)}</div>
          <ul className="flex flex-col divide-y divide-border rounded-lg border border-border bg-surface">
            {agent.tended.map((it) => (
              <li key={`${it.handle}/${it.slug}`} className="min-w-0">
                <Link href={`/${it.handle}/${it.slug}`} className="flex min-w-0 items-center gap-2 px-3 py-3 hover:bg-surface-2">
                  <span className="min-w-0 flex-1 truncate text-[0.8125rem] text-ink">{tr(it.title as LocaleText, lang) || it.slug}</span>
                  <span className="hidden shrink-0 text-[0.6875rem] text-muted sm:inline">{it.handle}</span>
                </Link>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[0.6875rem] text-muted">{t('list.responsibilityZoneByDomain', lang)}</p>
        </div>
      )}

      {(pinned.length > 0 || (isOwner && ownLight.length > 0)) && (
        <div className="mb-6">
          <div className="mb-2 flex items-center justify-between gap-2 text-[0.78125rem] font-semibold text-ink-2">
            <span className="inline-flex items-center gap-1.5">
              <Pin size={13} className="text-muted" /> {t('pinnedLabel', lang)}
            </span>
            {isOwner && <PinsPicker lists={ownLight} lang={lang} />}
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {pinned.map((it) => {
              const desc = tr(it.desc, lang)
              return (
                <Link
                  key={it.id}
                  href={`/${it.ownerHandle}/${it.slug}`}
                  className={buttonClass({ size: 'lg', className: 'group' })}
                >
                  <div className="truncate text-[0.875rem] font-semibold text-accent group-hover:underline">{tr(it.title, lang)}</div>
                  {desc && <p className="mt-1 line-clamp-2 text-[0.78125rem] leading-snug text-ink-2">{desc}</p>}
                  <div className="mt-2 flex items-center gap-3 font-mono text-[0.6875rem] text-muted">
                    <span>★ {it.starsCount}</span>
                    <span>⑂ {it.forksCount}</span>
                  </div>
                </Link>
              )
            })}
          </div>
        </div>
      )}

      {completions.length > 0 && (
        <div className="mb-6">
          <div className="mb-2 flex items-center gap-1.5 text-[0.78125rem] font-semibold text-ink-2">
            <GraduationCap size={14} className="text-muted" /> {t('profile.completedCourses', lang)}
            <span className="font-mono text-[0.6875rem] text-muted">{completions.length}</span>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {completions.map((c) => (
              <div key={c.templateId} className="rounded-lg border border-border bg-surface px-3.5 py-3">
                <Link href={`/${c.ownerHandle}/${c.slug}`} className="block truncate text-[0.875rem] font-semibold text-accent hover:underline">
                  {tr(c.title, lang)}
                </Link>
                <div className="mt-1.5 flex items-center justify-between gap-2 font-mono text-[0.6875rem] text-muted">
                  <span className="inline-flex items-center gap-1 text-ok">
                    <GraduationCap size={11} />{' '}
                    {dayMonthYear(c.completedAt, lang)}
                  </span>
                  {isOwner && (
                    <Link href={`/${c.ownerHandle}/${c.slug}/certificate`} className="inline-flex items-center gap-1 text-accent hover:underline">
                      <Award size={11} /> {t('profile.certificateShort', lang)}
                    </Link>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* key по году: смена года — это другой календарь, и выбранный в прежнем
          день фильтром больше не годится. */}
      <ActivitySection
        key={graphYear ?? 'rolling'}
        handle={handle}
        lang={lang}
        contributions={contributions}
        received={received}
        graphYear={graphYear}
        graphYears={graphYears}
        todayKey={todayKey}
        month={monthKey}
        monthTopics={monthTopics ?? []}
        activityNav={activityNav}
      />
    </>
  )
}
