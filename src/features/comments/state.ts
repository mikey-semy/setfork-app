import type { Lang } from '@/shared/i18n'
import { resolveAnchor, type TextAnchor } from './anchor'
import { fieldText, type AnchorableBlock, type CommentField } from './fields'

// Состояние якоря считается НА РЕНДЕРЕ против предложенных пунктов, а не хранится
// в колонках. Причина: у review-комментария «актуальность» меняется вместе с
// предложением, и синхронизируемые поля неизбежно отстают — тот же довод, по
// которому GitLab держит дешёвую проверку active? вместо доверия сохранённому
// флагу. В БД лежит только иммутабельный исходный якорь и снимок текста.

/** Три состояния — «потерян» показываем как догадку-осиротевший, а не прячем тред. */
export type ThreadState =
  | { state: 'anchored'; quote: string; outdated: boolean }
  | { state: 'reanchored'; quote: string; confidence: number; outdated: boolean }
  | { state: 'orphaned'; outdated: boolean }

/**
 * УСТАРЕЛ — обсуждение шло о тексте, которого больше нет (аналог Outdated у
 * GitHub, где ветка комментария уезжает из текущего диффа).
 *
 * Считается сравнением ВМОРОЖЕННОГО снимка поля с текущим текстом. Это отдельное
 * измерение от привязки: якорь может отлично находиться (цитата не тронута), а
 * пункт вокруг неё переписан — и тогда спор ниже уже про другое.
 *
 * Пустой снимок (треды до появления поля) устаревшими не считаем: «не знаем» —
 * не то же самое, что «устарел».
 */
function isOutdated(contextSnapshot: string, currentText: string): boolean {
  if (!contextSnapshot) return false
  return contextSnapshot.trim() !== currentText.trim()
}

/**
 * Где сейчас живёт якорь треда среди предложенных блоков.
 *
 * Блока с таким block_id в предложении нет — тред осиротел, и это ТОЧНЫЙ вывод
 * (идентичность стабильна), поэтому нечёткий поиск даже не запускаем.
 */
export function threadState(
  anchor: TextAnchor,
  field: CommentField,
  blockId: string,
  blocks: AnchorableBlock[],
  lang: Lang,
  /** Вмороженный снимок текста поля на момент создания треда (для «устарел»). */
  contextSnapshot = '',
): ThreadState {
  const block = blocks.find((b) => b.blockId && b.blockId === blockId)
  // Блока нет — он и осиротел, и заведомо устарел: текста, о котором спорили,
  // в предложении больше нет.
  if (!block) return { state: 'orphaned', outdated: !!contextSnapshot }

  const text = fieldText(block, field, lang)
  if (!text) return { state: 'orphaned', outdated: !!contextSnapshot }
  const outdated = isOutdated(contextSnapshot, text)

  const res = resolveAnchor(anchor, text)
  if (res.state === 'orphaned') return { state: 'orphaned', outdated }
  const quote = text.slice(res.start, res.end)
  if (res.state === 'anchored') return { state: 'anchored', quote, outdated }
  return { state: 'reanchored', quote, confidence: Math.round(res.confidence * 100), outdated }
}
