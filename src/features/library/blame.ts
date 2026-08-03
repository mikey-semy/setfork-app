import 'server-only'
import { and, asc, eq, lte } from 'drizzle-orm'
import { db, steps as stepsTable, templateVersions, templates } from '@/shared/db'
import type { LocaleText } from '@/shared/i18n'
import { lastChangedVersions, type HistoryBlock } from './block-identity'

// «Blame» по блокам: для каждого блока текущей версии — в какой версии его
// содержимое менялось в последний раз. Сопоставление блоков сквозь версии и
// определение «содержимое изменилось» живут в block-identity: это те же правила,
// по которым работает структурный дифф. Автора у версий пока не показываем —
// версия, дата и note.

export interface StepBlame {
  n: number
  title: LocaleText
  section: LocaleText
  lastVersion: number // версия, где контент блока последний раз изменился
  lastAt: Date
  note: string
}
export interface ListBlame {
  currentVersion: number
  steps: StepBlame[]
}

/** Блок версии: содержимое + идентичность + номер по порядку. */
type BlameBlock = HistoryBlock & { n: number }

export async function getListBlame(templateId: string): Promise<ListBlame | null> {
  const [tpl] = await db.select({ current: templates.currentVersion }).from(templates).where(eq(templates.id, templateId)).limit(1)
  if (!tpl) return null

  // Все блоки всех версий до текущей одним запросом (версии по возрастанию,
  // блоки по n). Выбираются ВСЕ поля содержимого: отпечаток блока обязан
  // покрывать блочную модель целиком, иначе правка остаётся невидимой.
  const rows = await db
    .select({
      version: templateVersions.version,
      createdAt: templateVersions.createdAt,
      note: templateVersions.note,
      n: stepsTable.n,
      blockId: stepsTable.blockId,
      type: stepsTable.type,
      content: stepsTable.content,
      title: stepsTable.title,
      desc: stepsTable.desc,
      command: stepsTable.command,
      level: stepsTable.level,
      why: stepsTable.why,
      section: stepsTable.section,
      subtasks: stepsTable.subtasks,
      refs: stepsTable.refs,
      hasImage: stepsTable.hasImage,
      imageKey: stepsTable.imageKey,
      needsHuman: stepsTable.needsHuman,
      needsHumanAsk: stepsTable.needsHumanAsk,
    })
    .from(stepsTable)
    .innerJoin(templateVersions, eq(stepsTable.versionId, templateVersions.id))
    .where(and(eq(templateVersions.templateId, templateId), lte(templateVersions.version, tpl.current)))
    .orderBy(asc(templateVersions.version), asc(stepsTable.n))

  const history: { version: number; blocks: BlameBlock[] }[] = []
  const verMeta = new Map<number, { createdAt: Date; note: string }>()
  for (const r of rows) {
    let bucket = history[history.length - 1]
    if (!bucket || bucket.version !== r.version) {
      bucket = { version: r.version, blocks: [] }
      history.push(bucket)
    }
    bucket.blocks.push({
      n: r.n,
      blockId: r.blockId,
      type: r.type,
      content: r.content,
      title: r.title,
      desc: r.desc,
      command: r.command,
      level: r.level,
      why: r.why,
      section: r.section,
      subtasks: r.subtasks,
      refs: r.refs,
      hasImage: r.hasImage,
      imageKey: r.imageKey,
      needsHuman: r.needsHuman,
      needsHumanAsk: r.needsHumanAsk,
    })
    if (!verMeta.has(r.version)) verMeta.set(r.version, { createdAt: r.createdAt, note: r.note })
  }

  const current = history[history.length - 1]
  // У текущей версии нет блоков — показывать нечего (версия без блоков в историю
  // не попадает вовсе: строк по ней нет).
  if (!current || current.version !== tpl.current) return { currentVersion: tpl.current, steps: [] }

  const lastVersions = lastChangedVersions(history)
  const out = current.blocks.map((b, i) => {
    const lastVersion = lastVersions[i]
    const meta = verMeta.get(lastVersion)!
    return { n: b.n, title: b.title, section: b.section, lastVersion, lastAt: meta.createdAt, note: meta.note }
  })
  return { currentVersion: tpl.current, steps: out }
}
