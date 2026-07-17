'use client'

import type { ReactNode } from 'react'
import { GnomeAvatar } from '@/shared/ui/GnomeAvatar'

/**
 * Реплика участника совета: аватарка + подпись роли + пузырь. Один примитив на оба места, где
 * совет «говорит»: беседа генерации (GenerationChat) и уточняющие вопросы в ней же.
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
const builtinSrc = (who?: string) => `/gnomes/${who && AVATARS.has(who) ? who : 'council'}.webp`

/** «Печатает…»: шаг идёт прямо сейчас. Спокойная пульсация в цвет текста — прыгающие точки выглядят дёшево. */
function TypingDots() {
  return (
    <span className="ml-2 inline-flex items-center gap-[3px] align-middle">
      {[0, 180, 360].map((delay) => (
        <span key={delay} className="size-[3px] animate-pulse rounded-full bg-current opacity-50" style={{ animationDelay: `${delay}ms` }} />
      ))}
    </span>
  )
}

export function CouncilBubble({ who, name, typing, src, children }: { who?: string; name?: string; typing?: boolean; src?: string; children: ReactNode }) {
  return (
    <div className="flex items-end gap-2.5">
      {/* Декоративная (роль названа рядом текстом). 64px: персонажи ростовые и с реквизитом, а внутри белого
          кружка занимают лишь 80% диаметра — мельче роль не узнаётся, а в ней весь смысл аватарки.
          Обычный <img>: статичная webp из public/, оптимизатор next/image ни к чему (как в shared/ui/Avatar). */}
      <GnomeAvatar src={src || builtinSrc(who)} size={64} className="size-16 shrink-0" />
      <div className="min-w-0">
        {name ? <div className="mb-1 pl-3.5 text-[11px] font-medium tracking-wide text-muted">{name}</div> : null}
        {/* Без тени и рамки: контраст даёт surface поверх canvas. Скруглённый угол у аватарки — «хвостик» реплики. */}
        <div className="w-fit rounded-2xl rounded-bl-md bg-(--surface) px-3.5 py-2 text-[13.5px] leading-[1.5] text-ink-2">
          {children}
          {typing ? <TypingDots /> : null}
        </div>
      </div>
    </div>
  )
}
