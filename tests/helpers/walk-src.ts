import { readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Обход исходников для архитектурных проверок.
 *
 * ⚠️ Заведён потому, что таких обходов в `tests/architecture` уже ШЕСТЬ — байт в байт
 * одинаковых, и каждый повторяет один и тот же трюк с `indexOf('src/')` при выводе пути.
 * Седьмую копию добавлять не стал; переводить существующие шесть — отдельная работа, к
 * цели того PR, в котором это замечено, отношения не имеющая.
 */
export function walkSrc(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walkSrc(p, out)
    else if (/\.tsx?$/.test(p)) out.push(p)
  }
  return out
}

/** Путь от корня репозитория — то, что читает человек в отчёте о падении. */
export const relSrc = (file: string): string => file.slice(file.indexOf('src/'))
