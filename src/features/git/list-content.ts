// Содержимое версии списка (порт `ListContent`) → форма провода.
// pb-сообщение для ЯДРА: канон list.json соберёт оно само — фронт правила формата
// не знает вовсе.
//
// Отдельным модулем без `server-only` намеренно: маппинг — чистая функция, и держать
// его внутри core.remote значило бы, что он не покрывается тестами (ровно так и было
// до Ф0a.2).
import type { ListBlock, ListContent } from '@/core'

/** Форма шага в pb-сообщении (SnapshotStep): proto3 не различает '' и отсутствие
 *  поля, поэтому необязательное отдаётся пустой строкой, а не undefined. */
export type WireStep = {
  n: number
  type: string
  contentJson: string
  blockId: string
  title: string
  desc: string
  command: string
  level: string
  why: string
  section: string
  subtasks: string[]
  refs: { label: string; url: string }[]
  /** Пометки, которые ядро отдаёт при чтении (снимок ветки, строгий разбор канона).
   *  На записи оно берёт их из текущей версии по blockId, поэтому в `toWireContent`
   *  они не собираются. */
  danger?: boolean
  imageKey?: string
  needsHuman?: boolean
  needsHumanAsk?: string
}

export type WireContent = {
  title: string
  desc: string
  tags: string[]
  ordered: boolean
  version: number
  steps: WireStep[]
}

/** Домен → провод. Ядро трактует пустые строки как «нет»: пустой `type` — шаг,
 *  пустой `url` — ссылка без адреса, пустой `blockId` — идентичности нет. */
export function toWireContent(c: ListContent): WireContent {
  return {
    title: c.title,
    desc: c.desc,
    tags: c.tags,
    ordered: c.ordered,
    version: c.version,
    steps: c.steps.map((s) => ({
      n: s.n,
      type: s.type ?? '',
      // Пустой payload — это «нет content», а не строка '{}': иначе у шага
      // появился бы бессмысленный объект, а у блока — лишние байты в каноне.
      contentJson: s.content && Object.keys(s.content).length > 0 ? JSON.stringify(s.content) : '',
      blockId: s.blockId ?? '',
      title: s.title,
      desc: s.desc,
      command: s.command,
      level: s.level,
      why: s.why,
      section: s.section,
      subtasks: s.subtasks,
      refs: s.refs.map((r) => ({ label: r.label, url: r.url ?? '' })),
    })),
  }
}

/** Провод → домен: один разбор шага на оба чтения — снимок ветки и строгий разбор
 *  канона (Ф4). Второй такой же неминуемо разошёлся бы с первым на очередном поле;
 *  именно так когда-то потерялись `blockId` и `danger`. */
export function fromWireStep(s: WireStep): ListBlock {
  return {
    n: s.n,
    // Блочная модель: '' и 'step' — шаг, у него нет ни type, ни content.
    ...(s.type && s.type !== 'step' ? { type: s.type, content: parseContentJson(s.contentJson) } : {}),
    // '' в proto = «идентичности нет» (данные старше ADR-0013).
    blockId: s.blockId || null,
    title: s.title,
    desc: s.desc,
    command: s.command,
    level: s.level,
    why: s.why,
    section: s.section,
    subtasks: s.subtasks,
    refs: s.refs.map((r) => ({ label: r.label, ...(r.url ? { url: r.url } : {}) })),
    // Пометка «разрушительный пункт»: смотрящий чужую правку обязан видеть её ДО
    // слияния, а не узнать из собранного скрипта.
    danger: s.danger === true,
    ...(s.imageKey ? { imageKey: s.imageKey } : {}),
    ...(s.needsHuman ? { needsHuman: true } : {}),
    ...(s.needsHumanAsk ? { needsHumanAsk: s.needsHumanAsk } : {}),
  }
}

/** Payload не-step блока: битый JSON от чужого клиента — не повод ронять чтение. */
function parseContentJson(json: string): Record<string, unknown> {
  if (!json) return {}
  try {
    const o: unknown = JSON.parse(json)
    return o && typeof o === 'object' ? (o as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

/** Провод → домен целиком (строгий разбор канона отдаёт именно содержимое). */
export function fromWireContent(c: WireContent): ListContent {
  return {
    title: c.title,
    desc: c.desc,
    tags: c.tags,
    ordered: c.ordered,
    version: c.version,
    steps: c.steps.map(fromWireStep),
  }
}
