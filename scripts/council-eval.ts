/**
 * council-eval.ts — ОФЛАЙН-замер качества уже сгенерированных списков: совет против
 * одиночной генерации.
 *
 * Почему офлайн, а не прогон живого совета: замер, который сам стоит денег, делают
 * редко — а значит им не пользуются. Здесь мы оцениваем то, что УЖЕ лежит в
 * generation_candidates, поэтому LLM не зовётся ни разу и запускать можно когда угодно.
 * Единственный внешний трафик — HEAD-запросы по ссылкам для grounding.
 *
 * Что считаем (три оси, по которым спорить бессмысленно):
 *   СТРУКТУРА — список выполним: пунктов в разумных границах, у каждого есть заголовок,
 *               уровень валиден. Не «нравится», а формально пригоден.
 *   GROUNDING — доля ссылок, которые ОТКРЫВАЮТСЯ. Абляция 2026-07-24 дала ~20-25% фейк-URL;
 *               'unknown' (geo-блок/бот-защита с RU-сервера) НЕ считаем мёртвым — врать в
 *               метрике хуже, чем признать неизвестное.
 *   ОБЪЁМ     — сколько пунктов и ссылок на список: цена совета должна что-то покупать.
 *
 * Запуск (трат нет):
 *   npx tsx --conditions=react-server --env-file=.env --env-file=.env.local scripts/council-eval.ts
 *   ... --no-links   # без проверки ссылок (совсем без сети)
 */
import { and, eq, isNotNull, sql } from 'drizzle-orm'
import { db, generationCandidates, generationMessages, generations, type CandidateItem } from '../src/shared/db'
import { checkUrls } from '../src/shared/lib/link-health'

const MIN_ITEMS = 3
const MAX_ITEMS = 30
const LEVELS = new Set(['required', 'recommended', 'optional'])

interface Scored {
  engine: 'council' | 'single'
  accepted: boolean
  items: number
  structureOk: boolean
  refs: string[]
}

const loc = (v: unknown): string => {
  if (typeof v === 'string') return v
  if (v && typeof v === 'object') return Object.values(v as Record<string, string>).find(Boolean) ?? ''
  return ''
}

/** Формальная пригодность списка. Не вкус — проверяемые инварианты. */
function structureOk(items: CandidateItem[]): boolean {
  if (items.length < MIN_ITEMS || items.length > MAX_ITEMS) return false
  return items.every((it) => loc(it.title).trim().length > 0 && (!it.level || LEVELS.has(it.level)))
}

function refsOf(items: CandidateItem[]): string[] {
  return items
    .flatMap((it) => (it.refs ?? []).map((r) => (r as { url?: string }).url ?? ''))
    .map((u) => u.trim())
    .filter((u) => /^https?:\/\//i.test(u))
}

async function main() {
  const withLinks = !process.argv.includes('--no-links')

  // Кто писал: наличие черновиков С АВТОРОМ = совет. Факт в данных, не догадка.
  const drafted = db
    .select({ gid: generationMessages.generationId, n: sql<number>`count(distinct ${generationMessages.who})::int`.as('n') })
    .from(generationMessages)
    .where(and(eq(generationMessages.kind, 'draft'), isNotNull(generationMessages.who)))
    .groupBy(generationMessages.generationId)
    .as('drafted')

  const rows = await db
    .select({
      items: generationCandidates.items,
      accepted: sql<boolean>`${generations.chosenTemplateId} is not null`,
      council: sql<boolean>`coalesce(${drafted.n}, 0) > 0`,
    })
    .from(generationCandidates)
    .innerJoin(generations, eq(generations.id, generationCandidates.generationId))
    .leftJoin(drafted, eq(drafted.gid, generationCandidates.generationId))

  const scored: Scored[] = rows.map((r) => {
    const items = (r.items ?? []) as CandidateItem[]
    return {
      engine: r.council ? 'council' : 'single',
      accepted: Boolean(r.accepted),
      items: items.length,
      structureOk: structureOk(items),
      refs: refsOf(items),
    }
  })
  if (!scored.length) {
    console.log('нет кандидатов для замера')
    process.exit(0)
  }

  // Ссылки проверяем ОДНИМ проходом на все уникальные URL — иначе один домен получил бы
  // десятки запросов и сам начал бы отдавать отказ (метрика мерила бы наш же троттлинг).
  let alive = new Map<string, string>()
  const allUrls = [...new Set(scored.flatMap((s) => s.refs))]
  if (withLinks && allUrls.length) {
    console.log(`проверяю ${allUrls.length} уникальных ссылок…`)
    alive = await checkUrls(allUrls)
  }

  const report = (engine: 'council' | 'single') => {
    const xs = scored.filter((s) => s.engine === engine)
    if (!xs.length) return null
    const urls = xs.flatMap((s) => s.refs)
    const verdicts = urls.map((u) => alive.get(u))
    const live = verdicts.filter((v) => v === 'live').length
    const dead = verdicts.filter((v) => v === 'dead').length
    const unknown = verdicts.filter((v) => v === 'unknown' || v == null).length
    const checkable = live + dead // 'unknown' из знаменателя ИСКЛЮЧАЕМ — иначе geo-блок выглядел бы как ложь модели
    return {
      candidates: xs.length,
      accepted: xs.filter((s) => s.accepted).length,
      structure: `${xs.filter((s) => s.structureOk).length}/${xs.length}`,
      avgItems: (xs.reduce((a, s) => a + s.items, 0) / xs.length).toFixed(1),
      refsPerList: (urls.length / xs.length).toFixed(1),
      grounding: checkable ? `${Math.round((live / checkable) * 100)}% (${live}/${checkable})` : 'n/a',
      unknownLinks: unknown,
    }
  }

  const c = report('council')
  const s = report('single')
  console.log('\n=== Качество уже сгенерированного (LLM не звался) ===')
  console.table({ council: c ?? {}, single: s ?? {} })
  console.log(
    '\ngrounding = доля ОТКРЫВАЮЩИХСЯ ссылок среди проверяемых; «unknown» (geo-блок/бот-защита\n' +
      'с RU-сервера) в знаменатель НЕ входит — иначе недоступность выглядела бы как ложь модели.',
  )
  if (c && s) {
    // eslint-disable-next-line no-restricted-syntax -- консольный вывод скрипта, не UI
    const better = (a: string, b: string) => (parseFloat(a) > parseFloat(b) ? 'совет' : parseFloat(a) < parseFloat(b) ? 'одиночка' : 'равно')
    console.log(`\nобъём: ${better(c.avgItems, s.avgItems)} · ссылок на список: ${better(c.refsPerList, s.refsPerList)}`)
    console.log('приёмка: совет ' + c.accepted + '/' + c.candidates + ' vs одиночка ' + s.accepted + '/' + s.candidates)
  }
  process.exit(0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
