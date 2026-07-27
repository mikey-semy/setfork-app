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
  | { state: 'anchored'; quote: string }
  | { state: 'reanchored'; quote: string; confidence: number }
  | { state: 'orphaned' }

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
): ThreadState {
  const block = blocks.find((b) => b.blockId && b.blockId === blockId)
  if (!block) return { state: 'orphaned' }

  const text = fieldText(block, field, lang)
  if (!text) return { state: 'orphaned' }

  const res = resolveAnchor(anchor, text)
  if (res.state === 'orphaned') return { state: 'orphaned' }
  const quote = text.slice(res.start, res.end)
  if (res.state === 'anchored') return { state: 'anchored', quote }
  return { state: 'reanchored', quote, confidence: Math.round(res.confidence * 100) }
}
