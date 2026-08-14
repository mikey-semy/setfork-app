'use client'

import { useState, useTransition } from 'react'
import { Check, Loader2, UserPlus } from 'lucide-react'
import { t, type Lang } from '@/shared/i18n'
import { toggleFollow } from './actions'
import { buttonClass } from '@/shared/ui/button-style'

export function FollowButton({ targetUserId, following, lang }: { targetUserId: string; following: boolean; lang: Lang }) {
  const [isFollowing, setIsFollowing] = useState(following)
  const [pending, start] = useTransition()

  const onClick = () => {
    setIsFollowing((v) => !v)
    start(() => toggleFollow(targetUserId))
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={pending}
      className={`${buttonClass({ className: 'w-full' })} disabled:opacity-70 ${
        isFollowing ? 'border border-border text-ink hover:border-danger hover:text-danger' : 'bg-primary text-primary-fg'
      }`}
    >
      {pending ? <Loader2 size={14} className="animate-spin" /> : isFollowing ? <Check size={14} /> : <UserPlus size={14} />}
      {isFollowing ? t('following', lang) : t('follow', lang)}
    </button>
  )
}
