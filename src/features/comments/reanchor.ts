import type { Lang } from '@/shared/i18n'
import { resolveAnchor, type AnchorResolution, type TextAnchor } from './anchor'
import { fieldText, type AnchorableBlock, type CommentField } from './fields'

// Пере-привязка тредов к ТЕКУЩЕЙ версии списка.
//
// Контракт трёх позиций взят у GitLab (PositionTracer, MIT): исходный якорь
// неизменен, текущий сдвигается вперёд, пока находится, а момент потери
// фиксируется отдельно. Наш блок опознаётся стабильным block_id, поэтому
// «какой пункт» — точный ответ без эвристик; эвристика остаётся только на
// «какая подстрока внутри поля».

export interface ThreadAnchorState {
  blockId: string
  field: CommentField
  anchorOriginal: TextAnchor
  anchorCurrent: TextAnchor | null
  anchorState: 'anchored' | 'reanchored' | 'orphaned'
  anchorConfidence: number | null
  anchorChangedAt: number | null
}

/** Что нужно записать в тред после пере-привязки (null — менять нечего). */
export interface ReanchorUpdate {
  anchorCurrent: TextAnchor | null
  anchorState: 'anchored' | 'reanchored' | 'orphaned'
  anchorConfidence: number | null
  anchorChangedAt: number | null
}

/**
 * Пересчитать якорь треда против блоков текущей версии.
 *
 * Блок исчез (нет block_id среди блоков версии) — тред осиротел: это ТОЧНЫЙ
 * вывод, а не догадка, поэтому нечёткий поиск даже не запускаем.
 */
export function reanchorThread(
  thread: ThreadAnchorState,
  blocks: AnchorableBlock[],
  version: number,
  lang: Lang,
): ReanchorUpdate | null {
  const block = blocks.find((b) => b.blockId && b.blockId === thread.blockId)
  if (!block) return orphan(thread, version)

  const text = fieldText(block, thread.field, lang)
  if (!text) return orphan(thread, version)

  // Ищем от ИСХОДНОГО якоря, а не от текущего: он неизменен, и накопленный
  // дрейф не уводит поиск всё дальше с каждой версией.
  const res: AnchorResolution = resolveAnchor(thread.anchorOriginal, text)
  if (res.state === 'orphaned') return orphan(thread, version)

  const next: TextAnchor = {
    ...thread.anchorOriginal,
    exact: text.slice(res.start, res.end),
    start: res.start,
    end: res.end,
  }
  const confidence = res.state === 'anchored' ? 100 : Math.round(res.confidence * 100)
  if (same(thread, res.state, next, confidence)) return null
  return {
    anchorCurrent: next,
    anchorState: res.state,
    anchorConfidence: confidence,
    // Якорь снова найден — отметку о потере снимаем (тред «воскрес» после отката).
    anchorChangedAt: null,
  }
}

function orphan(thread: ThreadAnchorState, version: number): ReanchorUpdate | null {
  if (thread.anchorState === 'orphaned') return null // уже осиротел — не переписываем версию потери
  return {
    // Текущий якорь замирает на последнем валидном месте (как position у GitLab).
    anchorCurrent: thread.anchorCurrent,
    anchorState: 'orphaned',
    anchorConfidence: thread.anchorConfidence,
    anchorChangedAt: version,
  }
}

function same(thread: ThreadAnchorState, state: string, next: TextAnchor, confidence: number): boolean {
  const cur = thread.anchorCurrent
  return (
    thread.anchorState === state &&
    thread.anchorConfidence === confidence &&
    thread.anchorChangedAt === null &&
    !!cur &&
    cur.start === next.start &&
    cur.end === next.end &&
    cur.exact === next.exact
  )
}
