import { DestructiveCommandError } from './destructive-command'
import { SecretFoundError } from './secret-scan'

/** Отказ стража содержимого для показа: вид, код причины и МЕСТО — шаг (строкой, как из
 *  адреса) либо файл автора (`path`; шаг тогда 0). */
export type ContentRefusal =
  | { kind: 'destructive'; reason: string; step: string; path?: string }
  | { kind: 'secret'; rule: string; step: string; path?: string }

/**
 * Отказ стража содержимого (команда или ключ) → значение, которое показывает
 * `ContentRefusalAlert`. Для путей, где отказ раньше летел исключением и становился
 * безымянной страницей ошибки: принятие варианта генерации, копии, садовник.
 */
export function contentRefusalOf(e: unknown): ContentRefusal | null {
  const at = (path?: string) => (path ? { path } : {})
  if (e instanceof DestructiveCommandError) return { kind: 'destructive', reason: e.reason, step: String(e.stepIndex), ...at(e.path) }
  if (e instanceof SecretFoundError) return { kind: 'secret', rule: e.match.rule, step: String(e.stepIndex), ...at(e.path) }
  return null
}

/** Отказ из параметров адреса (`?blocked=…&step=…` или `?secret=…&step=…`, у файла ещё
 *  `&file=…`); нет ни того, ни другого — `null`. */
export function contentRefusalFrom(sp: { blocked?: string; secret?: string; step?: string; file?: string }): ContentRefusal | null {
  const at = sp.file ? { path: sp.file } : {}
  if (sp.secret) return { kind: 'secret', rule: sp.secret, step: sp.step ?? '0', ...at }
  if (sp.blocked) return { kind: 'destructive', reason: sp.blocked, step: sp.step ?? '?', ...at }
  return null
}
