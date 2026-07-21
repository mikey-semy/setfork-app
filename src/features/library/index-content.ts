import type { LocaleText } from '@/shared/i18n'

/**
 * Сборка ТЕКСТА для эмбеддинга — чистые функции (KAG-lite шаг 1, HQ §5:
 * «список разбирается на части»). Отдельно от reindex.ts, чтобы юнит-тестить
 * без БД и server-only.
 */

export function flat(t: LocaleText | null | undefined): string {
  if (!t) return ''
  return Object.values(t).filter(Boolean).join(' / ')
}

export interface StepLike {
  type: string
  title: LocaleText | null
  desc?: LocaleText | null
  command?: string | null
  why?: LocaleText | null
  section?: LocaleText | null
  subtasks?: LocaleText[] | null
}

/**
 * Текст чанка-шага. Заголовок СПИСКА входит в текст сознательно: вектор шага без
 * темы («Замочить на 10 минут») почти бесполезен — контекст решает. why/subtasks
 * включаем (в общий вектор списка они не входят — тут их дом). null — блок не
 * индексируется: не-step типы (text/image/poll) и шаги без осмысленного заголовка.
 */
export function stepChunkContent(listTitle: string, s: StepLike): string | null {
  if (s.type !== 'step') return null
  const title = flat(s.title)
  if (title.trim().length < 3) return null
  const parts = [
    `${listTitle}${flat(s.section) ? ` · ${flat(s.section)}` : ''}: ${title}`,
    flat(s.desc),
    s.command ? `[${s.command}]` : '',
    flat(s.why),
    (s.subtasks ?? []).map(flat).filter(Boolean).join('; '),
  ]
  return parts.filter(Boolean).join('\n')
}
