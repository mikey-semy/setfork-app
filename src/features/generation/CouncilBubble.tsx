'use client'

import type { ReactNode } from 'react'
import { GnomeAvatar } from '@/shared/ui/GnomeAvatar'
import { Tooltip } from '@/shared/ui/Tooltip'
import { Badge } from '@/shared/ui/badge'

/**
 * Реплика участника совета — облачко как в мессенджере (фидбек владельца по
 * скринам Telegram): компактная аватарка у нижнего края, ИМЯ ВНУТРИ пузыря
 * первой строкой цветом, хвостик к аватарке. Один примитив на оба места, где
 * совет «говорит»: беседа генерации и уточняющие вопросы.
 *
 * Все реплики слева: пользователь в беседе не участник совета — его реплики
 * рендерит GenerationChat справа, без аватарки (он один и видит себя в шапке).
 */

// Аватарки: `public/gnomes/<id>.webp`. Ключи = id ролей движка (council.ts: EXPERTS.id + служебные).
// Белый список, а не прямая подстановка в src: неизвестный id (эксперта добавили, картинку не нарисовали)
// не должен давать битую картинку — молча берём общую.
const AVATARS = new Set([
  'planner', 'crier', 'seek-lists', 'seek-web', 'critic', 'elder', 'innovator', 'reporter', 'council',
  'devops', 'coder', 'chef', 'traveler', 'coach', 'scholar', 'hoarder', 'generalist',
])
const builtinSrc = (who?: string) => `/gnomes/${who && AVATARS.has(who) ? who : 'council'}.webp`

/** «Печатает…»: шаг идёт прямо сейчас. Спокойная пульсация в цвет текста — прыгающие точки выглядят дёшево. */
function TypingDots() {
  return (
    <span className="ml-2 inline-flex items-center gap-[0.1875rem] align-middle">
      {[0, 180, 360].map((delay) => (
        <span key={delay} className="size-[0.1875rem] animate-pulse rounded-full bg-current opacity-50" style={{ animationDelay: `${delay}ms` }} />
      ))}
    </span>
  )
}

export function CouncilBubble({ who, name, badge, badgeTitle, typing, src, children }: { who?: string; name?: string; badge?: string; badgeTitle?: string; typing?: boolean; src?: string; children: ReactNode }) {
  return (
    <div className="flex items-end gap-2">
      {/* Декоративная (роль названа в пузыре). 44px — мессенджер-масштаб: ростовые персонажи
          в 64px съедали строку чата (фидбек владельца «как статусы, не сообщения»). */}
      <GnomeAvatar src={src || builtinSrc(who)} size={44} className="size-11 shrink-0" />
      <div className="min-w-0">
        {/* Пузырь с хвостиком к аватарке; имя ВНУТРИ первой строкой цветом — как в Telegram. */}
        <div className="w-fit max-w-full rounded-2xl rounded-bl-md bg-surface-2 px-3.5 py-2 text-body leading-[1.5] text-ink-2">
          {name ? (
            <div className="mb-0.5 flex items-center gap-1.5 text-body-sm font-semibold text-accent">
              {name}
              {/* Репутация (HQ §6): доля советов, принятых людьми, — почему этому голосу можно верить. */}
              {badge ? (
                badgeTitle ? (
                  <Tooltip label={badgeTitle}>
                    <Badge variant="accent">{badge}</Badge>
                  </Tooltip>
                ) : (
                  <Badge variant="accent">{badge}</Badge>
                )
              ) : null}
            </div>
          ) : null}
          {children}
          {typing ? <TypingDots /> : null}
        </div>
      </div>
    </div>
  )
}
