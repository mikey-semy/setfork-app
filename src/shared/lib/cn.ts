import { clsx, type ClassValue } from 'clsx'
import { extendTailwindMerge } from 'tailwind-merge'

/**
 * Ступени лестницы кеглей из темы (`@theme` в globals.css).
 *
 * ⚠️ Список обязан совпадать с темой — иначе tailwind-merge принимает `text-body` за
 * ЦВЕТ (по устройству `text-*` двусмысленно: `text-sm` это размер, `text-muted` цвет,
 * и решает валидатор) и при склейке выбрасывает соседний `text-primary-fg` как
 * конфликтующий. Ровно это и случилось 26.08.2026 при переезде лестницы в тему:
 * основная кнопка осталась без цвета текста, поймал тест панели списков профиля.
 * Расхождение списка стережёт `tests/architecture/font-size-merge.test.ts`.
 */
const FONT_SIZE_STEPS = [
  'caption',
  'caption-lg',
  'body-sm',
  'body',
  'body-lg',
  'title',
  'page',
  'heading',
  'stat',
  'lead',
  'display',
  'display-lg',
  'logo',
  'logo-lg',
  'logo-xl',
]

/** Свои тени из темы — та же двусмысленность: `shadow-card` иначе считается ЦВЕТОМ
 *  тени, и `cn('shadow-card', 'shadow-none')` оставляет обе. */
const SHADOW_STEPS = ['card', 'hero']

const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      'font-size': [{ text: FONT_SIZE_STEPS }],
      shadow: [{ shadow: SHADOW_STEPS }],
    },
  },
})

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export { FONT_SIZE_STEPS, SHADOW_STEPS }
