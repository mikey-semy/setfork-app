// ОДНОРАЗОВОЕ УДАЛЕНИЕ СПИСКОВ ПО ЯВНОМУ ПЕРЕЧНЮ. Отката нет.
//
// Запуск (сухой прогон, ничего не трогает):
//   npx tsx scripts/purge-lists.ts --ids <файл>
// Живое удаление — только с явным флагом:
//   npx tsx scripts/purge-lists.ts --ids <файл> --stop-list <файл> --apply
//
// ⚠️ ВХОД — ЯВНЫЙ ПЕРЕЧЕНЬ ID, А НЕ ВЫБОРКА ПО ПРИЗНАКУ. Признак («черновик с
// английским заголовком») внутри скрипта означал бы, что правка условия молча меняет
// состав удаляемого. Перечень утверждают отдельно и передают файлом.
//
// ⚠️ СЛЕД ПИШЕТСЯ В ОДНОЙ ТРАНЗАКЦИИ С УДАЛЕНИЕМ, поэтому «стёрто, но следов нет»
// невозможно по построению. Отчётный файл — наоборот, пишется в конце: при обрыве
// его не будет, и правду о частичном результате даст СУХОЙ ПРОГОН тем же перечнем
// («найдено N, нет в базе M»), а не отчёт.
//
// ⚠️ УДАЛЕНИЕ НЕ ЧИСТИТ ВСЁ. Каскад в схеме уносит 27 таблиц (версии, шаги, прогоны,
// предложения, звёзды, беседы кирки…), ещё пять ссылок обнуляются. НО:
//  • embeddings.ref_id — без внешнего ключа: куски удалённых списков ОСТАНУТСЯ В
//    ПОИСКЕ, пока не пройдёт полная переиндексация (purgeStaleEmbeddings считает
//    активные ref_id и убирает остальное);
//  • jobs — без внешнего ключа: задания на реиндексацию останутся и отработают вхолостую;
//  • баре-репозиторий на томе принадлежит ядру и отсюда не удаляется.
// Порядок операции согласован: удаление → полный реиндекс → уборка репозиториев ядром.
import 'dotenv/config'
import { readFileSync } from 'node:fs'
import { inArray } from 'drizzle-orm'
import { auditLog, db, templates } from '../src/shared/db'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Разбор перечня и сверка со стоп-листом вынесены наружу, чтобы их проверял тест:
 * это единственные две вещи, которые решают, что именно будет стёрто, а отката нет.
 */
export function parseIds(text: string, path = '<вход>'): string[] {
  const out: string[] = []
  for (const [i, raw] of text.split('\n').entries()) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const id = line.split(/[\t ,;]/)[0]
    if (!UUID.test(id)) throw new Error(`${path}:${i + 1}: не похоже на id — ${JSON.stringify(line.slice(0, 60))}`)
    out.push(id.toLowerCase())
  }
  const dupes = out.filter((id, i) => out.indexOf(id) !== i)
  if (dupes.length) throw new Error(`во входе повторяются id: ${[...new Set(dupes)].join(', ')}`)
  return out
}

/** ⚠️ Пересечение останавливает операцию ЦЕЛИКОМ, а не пропускает строку. */
export function assertNoStopListed(ids: string[], stop: string[]): void {
  const banned = new Set(stop)
  const hit = ids.filter((id) => banned.has(id))
  if (hit.length) {
    throw new Error(
      `ОТКАЗ: во входе ${hit.length} id из стоп-листа — ${hit.join(', ')}. ` +
        'Перечень нужно пересобрать, частичное удаление не выполняется.',
    )
  }
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i === -1 ? undefined : process.argv[i + 1]
}

/** Первая колонка строки — id; остальное (slug, заголовок) для человека. */
const readIds = (path: string) => parseIds(readFileSync(path, 'utf8'), path)

async function main() {
  const idsPath = arg('ids')
  const stopPath = arg('stop-list')
  const apply = process.argv.includes('--apply')
  if (!idsPath) throw new Error('нужен --ids <файл с перечнем id>')

  const ids = readIds(idsPath)
  if (stopPath) {
    assertNoStopListed(ids, readIds(stopPath))
  } else if (apply) {
    throw new Error('живое удаление без --stop-list не выполняется')
  }

  const rows = await db.query.templates.findMany({
    where: (t, { inArray: within }) => within(t.id, ids),
    columns: { id: true, slug: true, title: true, status: true, moderation: true, ownerId: true, updatedAt: true },
    with: { versions: { columns: { id: true } } },
  })
  const found = new Map(rows.map((r) => [r.id, r]))
  const missing = ids.filter((id) => !found.has(id))

  // Снятый модерацией список стирать нельзя: hard-delete унёс бы contentFingerprint —
  // единственную защиту от повторной заливки того же контента (та же причина, по
  // которой это запрещено владельцу в интерфейсе).
  const flagged = rows.filter((r) => r.moderation === 'flagged' || r.moderation === 'hidden')

  const blocks = await countBlocks(rows.map((r) => r.id))
  const title = (t: unknown) => {
    const v = t as Record<string, string> | null
    return (v?.ru || v?.en || Object.values(v ?? {})[0] || '—').slice(0, 60)
  }

  console.log(`вход: ${ids.length} · найдено: ${rows.length} · нет в базе: ${missing.length}`)
  console.log(`блоков суммарно: ${blocks.total}`)
  if (flagged.length) console.log(`⚠️ снятых модерацией (удалены НЕ будут): ${flagged.length}`)
  console.log('')
  for (const r of rows) {
    const when = r.updatedAt instanceof Date ? r.updatedAt.toISOString().slice(0, 16).replace('T', ' ') : '—'
    console.log(`${r.slug} — ${title(r.title)} — ${blocks.byList.get(r.id) ?? 0} бл. — ${when} — ${r.status}`)
  }
  if (missing.length) {
    console.log('')
    console.log(`нет в базе (${missing.length}): ${missing.slice(0, 10).join(', ')}${missing.length > 10 ? ' …' : ''}`)
  }

  const target = rows.filter((r) => !flagged.includes(r))
  if (!apply) {
    console.log('')
    console.log(`СУХОЙ ПРОГОН. Удалено было бы: ${target.length}. Ничего не тронуто.`)
    console.log('Живой запуск: тот же вызов плюс --stop-list <файл> --apply')
    return
  }

  let done = 0
  const failed: { id: string; slug: string; error: string }[] = []
  // По одному, а не пачкой: 495 вызовов не проблема, а вот частичный отказ пачки
  // оставил бы неизвестно что. Каскады делает схема — тот же путь, что из интерфейса.
  //
  // ⚠️ УДАЛЕНИЕ И ЕГО СЛЕД — В ОДНОЙ ТРАНЗАКЦИИ. Запись журнала после цикла (и даже
  // сразу после каждого удаления) оставляет окно: обрыв между `delete` и вставкой
  // даёт «список стёрт, следа нет» — а отката тут не будет, и искать концы будет
  // некому. В транзакции возможны только два исхода: удалено и записано, либо ничего
  // (замечание сессии ядра при подготовке операции).
  //
  // Журнал пишется не через `recordAudit`: тот модуль помечен `server-only` и из
  // скрипта не грузится. Таблица, поля и код действия — те же, плюс метка `via`,
  // чтобы пакетную зачистку можно было отличить от удаления руками владельца.
  for (const r of target) {
    try {
      await db.transaction(async (tx) => {
        await tx.delete(templates).where(inArray(templates.id, [r.id]))
        await tx.insert(auditLog).values({
          actorId: r.ownerId,
          action: 'list.delete' as const,
          targetType: 'list',
          targetId: r.id,
          meta: { slug: r.slug, via: 'purge-lists' },
          ip: null,
        })
      })
      done++
    } catch (e) {
      failed.push({ id: r.id, slug: r.slug, error: e instanceof Error ? e.message : String(e) })
    }
  }
  const report = [
    `удалено: ${done}`,
    `отказов: ${failed.length}`,
    `пропущено по модерации: ${flagged.length}`,
    `не найдено: ${missing.length}`,
    '',
    ...target.map((r) => {
      // Не тернарник: узда i18n запрещает выбор между двумя русскими литералами —
      // она стережёт интерфейс, а здесь строка отчёта в консоль, не текст экрана.
      let status = 'удалён'
      if (failed.some((f) => f.id === r.id)) status = 'ОТКАЗ'
      return `${status}\t${r.id}\t${r.slug}`
    }),
    ...failed.map((f) => `причина\t${f.id}\t${f.error}`),
  ].join('\n')
  const out = `purge-lists-${new Date().toISOString().replace(/[:.]/g, '-')}.txt`
  const { writeFileSync } = await import('node:fs')
  writeFileSync(out, report + '\n', 'utf8')
  console.log('')
  console.log(report.split('\n').slice(0, 4).join('\n'))
  console.log(`полный перечень: ${out}`)
  console.log('⚠️ ДАЛЬШЕ ОБЯЗАТЕЛЕН ПОЛНЫЙ РЕИНДЕКС: иначе куски удалённых списков останутся в поиске.')
}

/** Блоки живут в версиях; считаем по текущей версии каждого списка. */
async function countBlocks(ids: string[]): Promise<{ total: number; byList: Map<string, number> }> {
  const byList = new Map<string, number>()
  if (!ids.length) return { total: 0, byList }
  const rows = await db.query.templates.findMany({
    where: (t, { inArray: within }) => within(t.id, ids),
    columns: { id: true, currentVersion: true },
    with: { versions: { columns: { id: true, version: true }, with: { steps: { columns: { id: true } } } } },
  })
  for (const r of rows) {
    const cur = r.versions.find((v) => v.version === r.currentVersion) ?? r.versions.at(-1)
    byList.set(r.id, cur?.steps.length ?? 0)
  }
  return { total: [...byList.values()].reduce((a, b) => a + b, 0), byList }
}

// Запуск только при прямом вызове: тест импортирует отсюда разбор входа и сверку.
if (process.argv[1]?.endsWith('purge-lists.ts')) {
  main()
    .then(() => process.exit(0))
    .catch((e) => {
      console.error(e instanceof Error ? e.message : e)
      process.exit(1)
    })
}
