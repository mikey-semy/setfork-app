// Бэкфилл steps.block_id — восстановление идентичности блоков в УЖЕ существующих
// версиях. Запуск: npx tsx scripts/backfill-block-ids.ts [--apply]
//
// Зачем: версия = полный снимок блоков, и steps.id у каждого снимка свой. Пока
// block_id не проставлен, дифф сопоставляет пункты по заголовку — переименование
// читается как «удалён + добавлен», одинаковые заголовки склеиваются. Новые
// версии идентичность несут сами (редактор → ProposedItem.blockId), а старым её
// нужно восстановить один раз — этим скриптом.
//
// Как: версии проходим по возрастанию. Первая раздаёт новые id. Каждая следующая
// наследует id от предыдущей по тому же ключу, что использует merge и дифф:
// сначала стабильный content.bid (он у не-step блоков есть давно), затем
// тип+подпись. Не нашлось пары — блок считается новым и получает свой id.
// Эвристика применяется ОДИН раз, дальше идентичность живёт сама.
//
// Идемпотентен: блоки с уже проставленным block_id не трогает. По умолчанию —
// сухой прогон; запись включается флагом --apply.
import 'dotenv/config'
import { randomUUID } from 'node:crypto'
import { asc, eq } from 'drizzle-orm'
import { db, steps as stepsTable, templateVersions, templates } from '@/shared/db'
import type { LocaleText } from '@/shared/i18n'

type Row = typeof stepsTable.$inferSelect

const norm = (s: string): string => s.trim().toLowerCase().replace(/\s+/g, ' ')
/** Любой непустой перевод — версии обычно хранят один и тот же язык. */
const anyText = (t: LocaleText | null | undefined): string => (t ? (Object.values(t).find(Boolean) ?? '') : '')

/** Ключ сопоставления блока между соседними версиями (тот же, что у merge/диффа). */
function matchKey(r: Row): string {
  const c = (r.content ?? {}) as Record<string, unknown>
  const bid = typeof c.bid === 'string' ? c.bid : ''
  const type = r.type || 'step'
  if (bid) return `${type}#${bid}`
  if (type === 'step') return `step:${norm(anyText(r.title))}`
  if (type === 'text') return `text:${norm(String(c.md ?? ''))}`
  if (type === 'image') return `image:${String(c.ref ?? '')}`
  return `${type}:${norm(JSON.stringify(c))}`
}

/** key → очередь индексов (дубликаты ключа внутри версии разводятся по порядку). */
function keyed(rows: Row[]): Map<string, number[]> {
  const out = new Map<string, number[]>()
  rows.forEach((r, i) => {
    const k = matchKey(r)
    out.set(k, [...(out.get(k) ?? []), i])
  })
  return out
}

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply')
  const lists = await db.select({ id: templates.id, slug: templates.slug }).from(templates)
  let touchedLists = 0
  let touchedBlocks = 0

  for (const list of lists) {
    const versions = await db
      .select({ id: templateVersions.id, version: templateVersions.version })
      .from(templateVersions)
      .where(eq(templateVersions.templateId, list.id))
      .orderBy(asc(templateVersions.version))

    let prevRows: Row[] = []
    let prevIds: string[] = []
    let listTouched = false

    for (const v of versions) {
      const rows = await db.select().from(stepsTable).where(eq(stepsTable.versionId, v.id)).orderBy(asc(stepsTable.n))
      const prevKeyed = keyed(prevRows)
      const taken = new Set<number>()
      const ids: string[] = []

      for (const r of rows) {
        // Уже есть идентичность — уважаем её и передаём дальше по цепочке.
        if (r.blockId) {
          ids.push(r.blockId)
          continue
        }
        const queue = prevKeyed.get(matchKey(r)) ?? []
        const hit = queue.find((i) => !taken.has(i))
        if (hit != null) {
          taken.add(hit)
          ids.push(prevIds[hit])
        } else {
          ids.push(randomUUID())
        }
      }

      for (let i = 0; i < rows.length; i++) {
        if (rows[i].blockId) continue
        listTouched = true
        touchedBlocks++
        if (apply) await db.update(stepsTable).set({ blockId: ids[i] }).where(eq(stepsTable.id, rows[i].id))
      }

      prevRows = rows
      prevIds = ids
    }
    if (listTouched) touchedLists++
  }

  console.log(`Списков затронуто: ${touchedLists}, блоков: ${touchedBlocks}`)
  // eslint-disable-next-line no-restricted-syntax -- вывод CLI-скрипта, не UI
  console.log(apply ? 'Готово — block_id проставлены.' : 'Сухой прогон. Повторить с --apply, чтобы записать.')
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
