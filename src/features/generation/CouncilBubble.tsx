'use client'

import type { ReactNode } from 'react'

/**
 * Реплика участника совета: аватарка + подпись роли + пузырь. Один примитив на оба места, где
 * совет «говорит»: живая беседа (GnomeLoader) и уточняющие вопросы (GenerationReview).
 *
 * Все реплики слева: пользователь в беседе не участник, он наблюдатель — его ход только в форме уточнений.
 */

// Аватарки: `public/gnomes/<id>.webp`. Ключи = id ролей движка (council.ts: EXPERTS.id + служебные).
// Белый список, а не прямая подстановка в src: неизвестный id (эксперта добавили, картинку не нарисовали)
// не должен давать битую картинку — молча берём общую.
const AVATARS = new Set([
  'planner', 'crier', 'seek-lists', 'seek-web', 'critic', 'elder', 'innovator', 'reporter', 'council',
  'devops', 'coder', 'chef', 'traveler', 'coach', 'scholar', 'hoarder', 'generalist',
])
const avatarSrc = (who?: string) => `/gnomes/${who && AVATARS.has(who) ? who : 'council'}.webp`

/** «Печатает…»: шаг идёт прямо сейчас. */
function TypingDots() {
  return (
    <span className="ml-1.5 inline-flex items-center gap-0.5 align-middle">
      {[0, 160, 320].map((delay) => (
        <span key={delay} className="size-1 animate-bounce rounded-full bg-(--accent)" style={{ animationDelay: `${delay}ms` }} />
      ))}
    </span>
  )
}

export function CouncilBubble({ who, name, typing, children }: { who?: string; name?: string; typing?: boolean; children: ReactNode }) {
  return (
    <div className="flex items-end gap-2">
      {/* Декоративная (роль названа рядом текстом). 56px: персонажи ростовые и с реквизитом — мельче не узнаются.
          Обычный <img>: статичная 5КБ webp из public/, оптимизатор next/image ни к чему (как в shared/ui/Avatar). */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={avatarSrc(who)} alt="" aria-hidden width={56} height={56} className="size-14 shrink-0" />
      <div className="min-w-0">
        {name ? <div className="mb-0.5 pl-3 text-[11px] font-medium text-muted">{name}</div> : null}
        <div className="w-fit rounded-2xl rounded-bl-sm bg-(--surface) px-3 py-1.5 text-[13px] text-ink-2 shadow-sm">
          {children}
          {typing ? <TypingDots /> : null}
        </div>
      </div>
    </div>
  )
}
