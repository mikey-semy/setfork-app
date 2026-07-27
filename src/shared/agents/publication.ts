import 'server-only'
import { log } from '@/shared/observability'

/**
 * Барьер модерации для АВТОНОМНОЙ публикации.
 *
 * Когда список публикует человек, модерационный гейт зовёт экшен публикации. Когда список
 * публикует петля (гейт готовности), тот же барьер обязан сработать — иначе автономная
 * публикация оказалась бы единственным путём в паблик, миновавшим проверку.
 *
 * Связывание — через composition root (instrumentation), как `registerAfterVersion` и
 * `registerIndexSource`: границы слоёв запрещают features зависеть друг от друга, а
 * копировать логику гейта (дедуп джобы + суточный кап проверок на автора) нельзя — копия
 * разъедется с оригиналом.
 */
type ModerationGate = (templateId: string) => Promise<void>

let gate: ModerationGate | null = null

export function registerModerationGate(fn: ModerationGate): void {
  gate = fn
}

/**
 * Провести только что опубликованный список через модерацию. До регистрации — no-op с
 * предупреждением: молча пропускать проверку нельзя, но и ронять петлю из-за модерации
 * тоже (сам гейт свои ошибки глушит).
 */
export async function moderateNewPublication(templateId: string): Promise<void> {
  if (!gate) {
    log.warn?.('moderation gate is not registered — autonomous publication went unchecked', { templateId })
    return
  }
  try {
    await gate(templateId)
  } catch (e) {
    log.warn?.('moderation gate failed after autonomous publication', { templateId, err: e instanceof Error ? e.message : String(e) })
  }
}
