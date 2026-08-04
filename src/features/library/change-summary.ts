// Описание изменений для заметки к версии. Раньше модели подавали два СПИСКА
// ЗАГОЛОВКОВ (before/after) — правка описания, команды или подпунктов в них не
// видна вовсе: BEFORE и AFTER совпадали, и модель, не найдя разницы, сочиняла
// совет вместо описания правки (жалоба владельца 04.08.2026: поменял один символ,
// получил «Удалите пустые пункты…»). Теперь считаем структурный дифф и отдаём
// модели ФАКТ: что за блок, что с ним сделали, какие поля затронуты.

import { blockLabel, type CmpStep, type DiffEntry } from './diff'

/** Плоские пункты (кандидат генерации, редактор) → форма, которую понимает дифф. */
export function flatToCmp(
  items: { title: string; desc?: string; command?: string; level?: string; why?: string; section?: string; subtasks?: string[]; refs?: { label: string; url: string }[] }[],
): CmpStep[] {
  return items.map((x) => ({
    title: x.title ?? '',
    desc: x.desc ?? '',
    command: x.command ?? '',
    level: (x.level as CmpStep['level']) ?? 'required',
    why: x.why ?? '',
    section: x.section,
    subtasks: x.subtasks ?? [],
    refs: x.refs,
  }))
}

export interface DiffSummary {
  added: number
  removed: number
  changed: number
  moved: number
}

/** Есть ли вообще что описывать (иначе звать модель незачем — и платить тоже). */
export function hasChanges(summary: DiffSummary): boolean {
  return summary.added + summary.removed + summary.changed + summary.moved > 0
}

const cut = (s: string, n = 60) => {
  const flat = s.replace(/\s+/g, ' ').trim()
  return flat.length > n ? `${flat.slice(0, n)}…` : flat
}

/** Поле блока по имени — для показа «было → стало» у изменённых полей. */
function fieldValue(e: { title: string; desc: string; command: string; why: string; subtasks: string[] }, field: string): string {
  if (field === 'title') return e.title
  if (field === 'desc') return e.desc
  if (field === 'command') return e.command
  if (field === 'why') return e.why
  if (field === 'subtasks') return e.subtasks.join('; ')
  return ''
}

/**
 * Дифф → компактный текст для модели. Одна строка на блок; у изменённого блока
 * перечислены затронутые поля, а для коротких значений показано «было → стало»,
 * чтобы правка одного символа читалась как правка одного символа.
 */
export function summarizeDiffForNote(entries: DiffEntry[], limit = 20): string {
  const lines: string[] = []
  entries.forEach((e, i) => {
    if (e.status === 'unchanged' || lines.length >= limit) return
    const what = `${e.type && e.type !== 'step' ? e.type : 'step'} ${i + 1} "${cut(blockLabel(e), 40)}"`
    if (e.status === 'added') lines.push(`+ added ${what}`)
    else if (e.status === 'removed') lines.push(`- removed ${what}`)
    else if (e.status === 'moved') lines.push(`~ moved ${what}`)
    else {
      const fields = e.changes.length ? e.changes.join(', ') : 'content'
      const details = e.changes
        .map((f) => {
          const before = cut(fieldValue(e.before ?? e, f), 40)
          const after = cut(fieldValue(e, f), 40)
          return before && after && before !== after ? `${f}: "${before}" → "${after}"` : ''
        })
        .filter(Boolean)
      lines.push(`* changed ${what} [${fields}]${details.length ? `\n    ${details.join('\n    ')}` : ''}`)
    }
  })
  const hidden = entries.filter((e) => e.status !== 'unchanged').length - lines.length
  if (hidden > 0) lines.push(`… and ${hidden} more block(s)`)
  return lines.join('\n')
}
