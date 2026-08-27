'use client'

import { useState, useTransition } from 'react'
import { Check, UserPlus } from 'lucide-react'
import { t, type Lang } from '@/shared/i18n'
import { toggleFollow } from './actions'
import { cn } from '@/shared/lib/cn'
import { buttonClass } from '@/shared/ui/button-style'
import { Spinner } from '@/shared/ui/Spinner'

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
      // ⚠️ Вариант берётся у примитива, а НЕ дописывается строкой поверх него.
      // Было: `${buttonClass({…})} … bg-primary text-primary-fg` через шаблонную строку.
      // Шаблонная строка складывает классы, но не РАЗРЕШАЕТ их конфликт: в разметке
      // оставались оба цвета текста — `text-ink` из варианта `outline` и `text-primary-fg`
      // сверху, — и побеждал тот, что стоит позже в собранном CSS, а не тот, что написан
      // позже здесь. На тёмной теме это давало светлый текст на светлом фоне: кнопку
      // «Подписаться» нельзя было прочитать вовсе (найдено владельцем 27.08.2026).
      // Разрешает конфликт только `cn` (tailwind-merge), и он внутри buttonClass.
      className={buttonClass({
        variant: isFollowing ? 'outline' : 'primary',
        className: cn('w-full disabled:opacity-70', isFollowing && 'hover:border-danger hover:text-danger'),
      })}
    >
      {pending ? <Spinner size="md" /> : isFollowing ? <Check size={14} /> : <UserPlus size={14} />}
      {isFollowing ? t('following', lang) : t('follow', lang)}
    </button>
  )
}
