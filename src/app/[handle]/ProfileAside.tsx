import Link from 'next/link'
import { Link2, MapPin } from 'lucide-react'
import { t } from '@/shared/i18n'
import { Avatar } from '@/shared/ui/Avatar'
import { AchievementsCard } from '@/features/profile/AchievementsCard'
import { FollowButton } from '@/features/follows/FollowButton'
import { SocialIcon, socialLabel } from '@/features/settings/socials'
import { displayUrl } from '@/shared/lib/link-label'
import { monthYear } from '@/shared/lib/date'
import type { ProfilePageData } from './load'
import { buttonClass } from '@/shared/ui/button-style'

type Props = Pick<
  ProfilePageData,
  'handle' | 'lang' | 'user' | 'viewer' | 'isOwner' | 'bigAvatar' | 'counts' | 'followCounts' | 'following' | 'received' | 'contributions' | 'achDisplay'
>

/**
 * Карточка человека слева (как у GitHub): аватар, имя, био, действие, счётчики,
 * контакты и достижения. Одна причина менять — состав визитки профиля.
 */
export function ProfileAside({ handle, lang, user, viewer, isOwner, bigAvatar, counts, followCounts, following, received, contributions, achDisplay }: Props) {
  return (
    <aside className="shrink-0 md:w-[17.5rem]">
      <Avatar handle={user.handle} avatarUrl={bigAvatar} size={180} rounded={user.avatarShape === 'square' ? 'rounded-2xl' : 'rounded-full'} />
      <div className="mt-4">
        {/* Имя и ник задаёт человек: слово без пробелов иначе вылезает за колонку
            профиля и тянет за собой всю страницу на мобиле. */}
        {user.name && <div className="text-[1.375rem] font-bold leading-tight text-ink [overflow-wrap:anywhere]">{user.name}</div>}
        <div className="text-[1.125rem] text-ink-2 [overflow-wrap:anywhere]">{user.handle}</div>
        {/* Профессия — должность под ником (у служебных участников буквальная). */}
        {user.profession && <div className="mt-0.5 text-[0.875rem] text-ink-2 [overflow-wrap:anywhere]">{user.profession}</div>}
        {/* ADR-0004: нечеловечность обязана быть видна — иначе профиль вводит в
            заблуждение. Пометка ДАННЫЕ (account_type), а не догадка по нику. */}
        {user.accountType === 'agent' && (
          <div className="mt-2 inline-flex items-center rounded-full border border-border bg-surface-2 px-2 py-0.5 text-[0.6875rem] font-semibold text-ink-2">
            {t('list.serviceAccount', lang)}
          </div>
        )}
      </div>
      {/* Био — 280 символов свободного текста, туда часто вставляют ссылку: без
          переноса одна такая строка уносила страницу на 2200px (экран 390). */}
      {user.bio && <p className="mt-3 text-[0.875rem] leading-snug text-ink [overflow-wrap:anywhere]">{user.bio}</p>}

      <div className="mt-4">
        {isOwner ? (
          <Link
            href="/settings"
            className={buttonClass({ className: 'w-full' })}
          >
            {t('editProfile', lang)}
          </Link>
        ) : viewer ? (
          <FollowButton targetUserId={user.id} following={following} lang={lang} />
        ) : (
          <Link href="/login" className={buttonClass({ variant: 'primary', className: 'w-full' })}>
            {t('follow', lang)}
          </Link>
        )}
      </div>

      <div className="mt-3 flex gap-4 text-[0.8125rem]">
        <Link href={`/${handle}?tab=followers`} className="text-ink-2 hover:text-accent">
          <b className="text-ink">{followCounts.followers}</b> {t('followersLabel', lang)}
        </Link>
        <Link href={`/${handle}?tab=following`} className="text-ink-2 hover:text-accent">
          <b className="text-ink">{followCounts.following}</b> {t('followingLabel', lang)}
        </Link>
      </div>

      <div className="mt-3 font-mono text-[0.78125rem] text-muted">
        {t('joined', lang)} {monthYear(user.createdAt, lang)}
      </div>
      <div className="mt-4 flex gap-4 text-[0.8125rem]">
        <span className="text-ink-2">
          <b className="text-ink">{counts.lists}</b> {t('lists', lang).toLowerCase()}
        </span>
        <span className="text-ink-2">
          <b className="text-ink">{counts.stars}</b> {t('starredTab', lang).toLowerCase()}
        </span>
      </div>

      {(user.location || user.website || user.socials.length > 0) && (
        <div className="mt-4 flex flex-col gap-2 text-[0.8125rem]">
          {user.location && (
            <div className="flex min-w-0 items-center gap-2 text-ink-2 [overflow-wrap:anywhere]">
              <MapPin size={15} className="shrink-0 text-muted" /> {user.location}
            </div>
          )}
          {user.website && (
            <a href={user.website} target="_blank" rel="noopener noreferrer nofollow" className="flex items-center gap-2 text-accent hover:underline">
              <Link2 size={15} className="shrink-0 text-muted" /> <span className="truncate">{displayUrl(user.website)}</span>
            </a>
          )}
          {user.socials.map((s) => (
            <a
              key={`${s.type}:${s.url}`}
              href={s.url}
              target="_blank"
              rel="noopener noreferrer nofollow"
              className="flex items-center gap-2 text-ink-2 hover:text-ink"
            >
              <SocialIcon type={s.type} className="shrink-0 text-muted" /> <span className="truncate">{socialLabel(s.type)}</span>
            </a>
          ))}
        </div>
      )}

      {/* Достижения — в левом сайдбаре (как у GitHub), отдельно от ленты активности. */}
      <AchievementsCard
        input={{
          listsAuthored: counts.lists,
          starsReceived: received.stars,
          forksReceived: received.forks,
          runsStarted: counts.runs,
          contributions,
        }}
        lang={lang}
        config={achDisplay}
      />
    </aside>
  )
}
