import 'server-only'
import { createHash } from 'node:crypto'
import type { ProposedItem } from '@/shared/db'

/**
 * РЕВИЗИЯ предложения — «то ли это, что проверяли».
 *
 * Внешняя проверка отчитывается о конкретном содержимом. Без привязки к нему отчёт
 * «ок» жил вечно: автор дописывал предложение или обновлял ветку из main, а гейт
 * продолжал считать, что всё проверено. Слить непроверенное можно было в два клика.
 *
 * Что берём за ревизию:
 *  - у предложения ИЗ ВЕТКИ — tip ветки: любой новый коммит меняет его;
 *  - у предложения ИЗ ПУНКТОВ — отпечаток самих пунктов: правка меняет его, а
 *    перезапись тем же содержимым (сохранили без изменений) — нет, и это верно:
 *    проверять заново нечего.
 *
 * Отпечаток считается по КАНОНИЧЕСКОМУ виду: ключи объектов сортируются, поэтому
 * порядок полей в JSON на него не влияет. Иначе безобидная пересборка объекта
 * сбрасывала бы зелёные проверки на ровном месте.
 */
export function itemsRevision(items: ProposedItem[]): string {
  return `items:${createHash('sha256').update(canonical(items)).digest('hex').slice(0, 32)}`
}

export function branchRevision(tipSha: string): string {
  return `branch:${tipSha}`
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object') {
    const rec = value as Record<string, unknown>
    const keys = Object.keys(rec).sort()
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonical(rec[k])}`).join(',')}}`
  }
  return JSON.stringify(value ?? null)
}
