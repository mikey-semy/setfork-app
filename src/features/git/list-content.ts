// Содержимое версии списка (порт `ListContent`) → форма провода.
// pb-сообщение для ЯДРА: канон list.json соберёт оно само — фронт правила формата
// не знает вовсе.
//
// Отдельным модулем без `server-only` намеренно: маппинг — чистая функция, и держать
// его внутри core.remote значило бы, что он не покрывается тестами (ровно так и было
// до Ф0a.2).
import type { ListContent } from '@/core'

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
