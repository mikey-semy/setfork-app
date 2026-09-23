/**
 * Замер: кто из гномов поведёт в шахту по конкретному пункту списка — нынешнее правило
 * против Jev (TypeSafe, через Decisions API OpenRouter).
 *
 * Постановка и эталон — setfork-hq `research/2026-09-23-jev-gnome-routing` (README, TASK).
 * Набор и ростер перенесены оттуда байт в байт (`scripts/lib/gnome-routing/`): скрипт
 * живёт сам по себе, а не читает соседний репозиторий.
 *
 * ⚠️ Разметку эталона не править, чтобы цифры стали лучше. Она черновая (делал агент, не
 * сверял владелец) и общая для обоих участников; спорный пункт — в отчёт, а не в набор.
 *
 * Базовая линия — НАСТОЯЩЕЕ правило `tenderForTags`: его чистое ядро `rankByAffinity`,
 * лучший с баллом больше нуля, иначе универсал. Сам `tenderForTags` заводит аккаунт гнома
 * в БД, поэтому зовётся ядро, а не обёртка; пересказом оно не является — это та же функция.
 *
 * Запуск (`server-only` снимается условием экспорта, а не заглушкой — см. Commitics «Пакет,
 * который ломается нарочно»):
 *
 *   npx tsx --conditions=react-server scripts/gnome-routing-eval.ts --baseline   # без денег и базы
 *   npx tsx --conditions=react-server scripts/gnome-routing-eval.ts --dry        # тело запроса к Jev
 *   npx tsx --conditions=react-server scripts/gnome-routing-eval.ts --selfcheck  # живые проверки клиента
 *   npx tsx --conditions=react-server scripts/gnome-routing-eval.ts              # базовая линия + Jev
 *
 * Для прогона Jev нужны ключ OpenRouter (БД → env) и DATABASE_URL: каждый вызов пишется в
 * `ai_usage` с фичей `decide`. Итог печатается и кладётся в `--out <файл>`, если задан; сырые
 * ответы Jev — рядом, в `<файл>.jev.json`.
 */
import { randomUUID } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { rankByAffinity } from '../src/shared/ai/precedent-filter'
import { guideAbout, guideQuestion, guideState } from '../src/shared/ai/guide-question'

const HERE = join(dirname(fileURLToPath(import.meta.url)), 'lib', 'gnome-routing')
/** Сколько запросов к Jev одновременно — как в исходном прогоне HQ (`run.mts`). */
const CONCURRENCY = 4

type Gnome = { id: string; about: string; domains: string[]; candidate?: boolean }
type Item = { id: string; list: string; n: number; kind: string; section: string | null; text: string; gold: string; ok: string[]; why: string }
type ListMeta = { ref: string; title: string; tags: string[] }
type Pred = { id: string; pred: string; confidence?: number; probs?: Record<string, number>; inputTokens?: number; cost?: number; model?: string; error?: string }

// `--roster prod` — ростер прода (`list_gnomes` 23.09.2026): домены те же, что в наборе, а
// `about` — как его отдаёт персона, без ручной нормализации. Так мерится ровно то, что
// кирка отправит в проде. По умолчанию — исходный ростер исследования (для 30/57).
const ROSTER_FILE = process.argv.includes('--roster') && process.argv[process.argv.indexOf('--roster') + 1] === 'prod' ? 'gnomes-prod.json' : 'gnomes.json'
const roster: Gnome[] = JSON.parse(readFileSync(join(HERE, ROSTER_FILE), 'utf8')).gnomes
const ds = JSON.parse(readFileSync(join(HERE, 'dataset.json'), 'utf8')) as { lists: Record<string, ListMeta>; items: Item[] }

// ── базовая линия: ядро tenderForTags; никто не подошёл — универсал.
//
// ⚠️ Фолбэк на универсала — правило ЗАМЕРА (README HQ: «иначе универсал»), а не прода:
// сам `tenderForTags` в этом случае возвращает null, и вызывающие берут служебный аккаунт
// или отказываются. Для кирки универсал и есть задуманный запасной проводник, поэтому
// правило сохранено — иначе не сошлась бы исходная базовая линия 30/57. Сколько её
// «допустимых» держится только на фолбэке, отчёт показывает отдельной строкой (авто-ревью
// к #961).
const noSpecialist = (tags: string[]) => rankByAffinity(tags, roster).length === 0
function baseline(tags: string[]): string {
  return rankByAffinity(tags, roster)[0]?.id ?? 'generalist'
}

// ── Jev: один вопрос choice на пункт — ТОТ ЖЕ, что задаёт кирка (`guide-question`), иначе
// замер мерил бы не то, что встроено. Разведчик исключается там же (роль, а не ремесло).
// `about` — через тот же `guideAbout`, что в кирке (первое предложение, без точки).
const QUESTION = guideQuestion(roster.map((g) => ({ ...g, about: guideAbout(g.about) })))

function stateOf(it: Item): string {
  const l = ds.lists[it.list]
  return guideState({ listTitle: l.title, tags: l.tags, section: it.section, item: it.text })
}

async function pool<T, R>(xs: T[], n: number, f: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(xs.length)
  let i = 0
  await Promise.all(
    Array.from({ length: n }, async () => {
      while (i < xs.length) {
        const k = i++
        out[k] = await f(xs[k])
      }
    }),
  )
  return out
}

// ── счёт — как в run.mts: «точно», «допустимо», срез по разборам, уверенность, промахи
const COMMITICS = new Set(['hmac', 'zero', 'pkg'])
function score(name: string, preds: Pred[]): string {
  const byId = new Map(preds.map((p) => [p.id, p]))
  const rows = ds.items.map((it) => {
    const p = byId.get(it.id)!
    return { it, p, strict: p.pred === it.gold, ok: p.pred === it.gold || it.ok.includes(p.pred) }
  })
  const pct = (a: number, b: number) => (b ? `${Math.round((100 * a) / b)} %` : '—')
  const part = (f: (r: (typeof rows)[number]) => boolean) => {
    const s = rows.filter(f)
    return { n: s.length, strict: s.filter((r) => r.strict).length, ok: s.filter((r) => r.ok).length }
  }
  const all = part(() => true)
  const com = part((r) => COMMITICS.has(r.it.list))
  const rest = part((r) => !COMMITICS.has(r.it.list))
  const lines = [
    `### ${name}`,
    '',
    '| Срез | Пунктов | Точно | Допустимо |',
    '|---|---|---|---|',
    `| Все | ${all.n} | ${all.strict} (${pct(all.strict, all.n)}) | ${all.ok} (${pct(all.ok, all.n)}) |`,
    `| Разборы (commitics) | ${com.n} | ${com.strict} (${pct(com.strict, com.n)}) | ${com.ok} (${pct(com.ok, com.n)}) |`,
    `| Остальные | ${rest.n} | ${rest.strict} (${pct(rest.strict, rest.n)}) | ${rest.ok} (${pct(rest.ok, rest.n)}) |`,
    '',
  ]
  const withConf = rows.filter((r) => typeof r.p.confidence === 'number')
  if (withConf.length) {
    lines.push('Уверенность как сигнал «отдать универсалу или человеку»:', '', '| Порог | Покрытие | Допустимо среди уверенных |', '|---|---|---|')
    for (const t of [0.5, 0.7, 0.9]) {
      const s = withConf.filter((r) => r.p.confidence! >= t)
      // Знаменатель — ВСЕ пункты, а не только ответившие: сбой (таймаут, неразобранный
      // ответ) уверенности не имеет, и без него покрытие выглядело бы полным там, где
      // пункт на деле ушёл бы запасному правилу (находка авто-ревью к #961).
      lines.push(`| ≥ ${t} | ${s.length}/${rows.length} | ${pct(s.filter((r) => r.ok).length, s.length)} |`)
    }
    lines.push('')
  }
  const miss = rows.filter((r) => !r.ok)
  if (miss.length) {
    lines.push('Промахи:', '', '| Пункт | Ждали | Выбрано | Уверенность |', '|---|---|---|---|')
    for (const r of miss) lines.push(`| ${r.it.id} | ${r.it.gold} | ${r.p.pred}${r.p.error ? ' ⚠️' : ''} | ${r.p.confidence?.toFixed(2) ?? '—'} |`)
    lines.push('')
  }
  return lines.join('\n')
}

async function main() {
  const args = process.argv.slice(2)
  const outAt = args.indexOf('--out')
  const out = outAt >= 0 ? args[outAt + 1] : undefined
  // Незнакомый ключ — ошибка, а не молчание: иначе прогон с опечаткой или с ключом из
  // другой версии скрипта тихо мерит не то, что написано в его подписи (так и случилось с
  // `--roster prod` — авто-ревью к #961).
  // `--out` без значения потерял бы отчёт после платного прогона, а следующий ключ съелся
  // бы как имя файла — проверяем ДО прогона (авто-ревью к #961).
  if (outAt >= 0 && (!out || out.startsWith('--'))) {
    console.error('--out требует путь к файлу отчёта')
    process.exitCode = 2
    return
  }
  const KNOWN = new Set(['--baseline', '--dry', '--selfcheck', '--out'])
  const unknown = args.filter((a, i) => a.startsWith('--') && !KNOWN.has(a) && args[i - 1] !== '--out')
  if (unknown.length) {
    console.error(`незнакомые ключи: ${unknown.join(', ')}; известны: ${[...KNOWN].join(', ')}`)
    process.exitCode = 2
    return
  }

  if (args.includes('--selfcheck')) {
    await selfcheck()
    return
  }

  if (args.includes('--dry')) {
    // Ровно то тело, что уйдёт в запрос (`decideBody`): со spotlight и политикой данных, а
    // не заготовка до них — иначе предпросмотр не проверяет самого важного (авто-ревью к #961).
    const { decideBody, decideModel } = await import('../src/shared/ai/decide')
    console.log(JSON.stringify(decideBody(await decideModel(), stateOf(ds.items[0]), { guide: QUESTION }), null, 2))
    return
  }

  const base: Pred[] = ds.items.map((it) => ({ id: it.id, pred: baseline(ds.lists[it.list].tags) }))
  const report = [`# Результаты — ${new Date().toISOString().slice(0, 10)}`, '', score('Базовая линия: tenderForTags (теги списка × домены)', base)]
  const byFallback = ds.items.filter((it) => noSpecialist(ds.lists[it.list].tags))
  const okByFallback = byFallback.filter((it) => it.gold === 'generalist' || it.ok.includes('generalist')).length
  report.push(
    `Мастера по тегам не нашлось у ${byFallback.length} пунктов из ${ds.items.length}: им назначен универсал — правило замера, в проде \`tenderForTags\` вернул бы null. Из «допустимых» базовой линии ${okByFallback} держатся только на этом фолбэке.`,
    '',
  )

  if (!args.includes('--baseline')) {
    const { decide, decideModel } = await import('../src/shared/ai/decide')
    const model = await decideModel()
    // Один uuid на прогон (`ai_usage.ref_id` — uuid): по нему расход прогона сверяется с журналом.
    const runId = randomUUID()
    // Счёт по НАСТОЯЩИМ запросам, с неокруглённой стоимостью из ответов (`onAttempt`):
    // пункт, отсеянный бюджетом, запросом не был, а журнал округляет стоимость до шести
    // знаков — при цене вызова около 0,00006 это процент ошибки (авто-ревью к #961).
    const attempts = { n: 0, cost: 0, tokens: 0 }
    const count = (a: { cost: number; inputTokens: number }) => {
      attempts.n++
      attempts.cost += a.cost
      attempts.tokens += a.inputTokens
    }
    const t0 = Date.now()
    const jev: Pred[] = await pool(ds.items, CONCURRENCY, async (it) => {
      const r = await decide({ state: stateOf(it), questions: { guide: QUESTION }, refType: 'gnome-routing-eval', refId: runId, onAttempt: count })
      if (!r) return { id: it.id, pred: '?', error: 'decide() вернул null' }
      const a = r.answers.guide
      return {
        id: it.id,
        pred: a?.type === 'choice' ? a.choice : '?',
        confidence: a?.confidence,
        probs: a?.type === 'choice' ? a.probabilities : undefined,
        inputTokens: r.usage.inputTokens,
        cost: r.usage.cost,
        model: r.model,
      }
    })
    const secs = (Date.now() - t0) / 1000
    const answered = [...new Set(jev.map((p) => p.model).filter(Boolean))].join(', ') || model
    // Стоимость — ТОЛЬКО из ответов (`usage.cost`), без оценки по прайсу, неокруглённая и
    // включая оплаченные неудачи. Журнал `ai_usage` — для сверки: там те же вызовы, но с
    // округлением до шести знаков.
    const { db, aiUsage } = await import('../src/shared/db')
    const { and, eq, sql } = await import('drizzle-orm')
    const [journal] = await db
      .select({ usd: sql<number>`coalesce(sum(${aiUsage.costUsd}), 0)::float8`, calls: sql<number>`count(*)::int` })
      .from(aiUsage)
      .where(and(eq(aiUsage.refType, 'gnome-routing-eval'), eq(aiUsage.refId, runId)))
    const errors = jev.filter((p) => p.error)
    report.push(score(`Jev (${answered}, через OpenRouter Decisions, ростер ${ROSTER_FILE})`, jev))
    report.push(
      `Прогон: ${jev.length} пунктов, ${attempts.n} запросов к провайдеру за ${secs.toFixed(1)} с, ${attempts.tokens} входных токенов, $${attempts.cost.toFixed(6)} — сумма \`usage.cost\` из ответов (журнал \`ai_usage\`: ${journal?.calls ?? 0} строк, $${(journal?.usd ?? 0).toFixed(6)} с округлением до 6 знаков), ошибок: ${errors.length}.`,
      '',
    )
    // Сырые ответы — рядом с отчётом, а не в репозитории: иначе каждый прогон пачкал бы дерево.
    if (out) writeFileSync(out.replace(/\.md$/, '') + '.jev.json', JSON.stringify(jev, null, 1))
  }

  const text = report.join('\n')
  if (out) writeFileSync(out, text)
  console.log(text)
}

/**
 * Живые проверки клиента, которые задание требует доказать, а не предположить:
 *  1. политика данных (по умолчанию `deny`) пропускает Jev — иначе OpenRouter ответит
 *     «No endpoints found», и тогда НЕ переключать глобальную политику, а докладывать;
 *  2. заведомо несуществующая модель — `null`, без исключения, и строка с ошибкой в журнале.
 */
async function selfcheck() {
  const { decide } = await import('../src/shared/ai/decide')
  const { dataCollectionPolicy } = await import('../src/shared/ai/provider')
  const { db, aiUsage } = await import('../src/shared/db')
  const { and, desc, eq } = await import('drizzle-orm')
  // `ai_usage.ref_id` — uuid: один на прогон, по нему строки прогона и находятся.
  const ref = randomUUID()
  const it = ds.items[0]

  console.log(`политика данных: ${dataCollectionPolicy()}`)
  const ok = await decide({ state: stateOf(it), questions: { guide: QUESTION }, refType: 'gnome-routing-selfcheck', refId: ref })
  // Проверка без кода выхода — не проверка: скрипт и оператор верят статусу, а не тексту
  // (авто-ревью к #961). Каждый провал поднимает `process.exitCode`.
  const fail = (why: string) => {
    console.log(`   ⛔ ${why}`)
    process.exitCode = 1
  }
  if (ok) {
    const g = ok.answers.guide
    console.log(`1. Jev ответил под этой политикой: ${ok.model}, выбор ${g.type === 'choice' ? g.choice : g.type}, $${ok.usage.cost}`)
  } else {
    console.log('1. Jev НЕ ответил под этой политикой — смотри предупреждение [decide] выше')
    fail('политика данных не пропустила Jev (или сбой) — глобальную политику НЕ переключать, докладывать владельцу')
  }

  let threw = false
  let res: unknown = 'не звали'
  try {
    res = await decide({ state: 'x', questions: { guide: QUESTION }, model: 'typesafe/no-such-model', refType: 'gnome-routing-selfcheck', refId: ref })
  } catch {
    threw = true
  }
  console.log(`2. несуществующая модель: результат ${JSON.stringify(res)}`)
  if (threw) fail('исключение — вызывающий упал бы')
  else if (res !== null) fail('ожидался null')
  else console.log('   исключения нет')

  const rows = await db
    .select({ model: aiUsage.model, outcome: aiUsage.outcome, cost: aiUsage.costUsd, feature: aiUsage.feature })
    .from(aiUsage)
    .where(and(eq(aiUsage.refType, 'gnome-routing-selfcheck'), eq(aiUsage.refId, ref)))
    .orderBy(desc(aiUsage.createdAt))
  console.log('строки ai_usage этого прогона:')
  for (const r of rows) console.log(`   ${r.feature} · ${r.model} · ${r.outcome} · $${r.cost}`)
  if (!rows.some((r) => r.outcome === 'ok')) fail('в журнале нет строки удачного вызова')
  if (!rows.some((r) => r.outcome === 'error' && r.model === 'typesafe/no-such-model')) fail('в журнале нет строки сбоя')
  if (process.exitCode) console.log('ИТОГ: проверка НЕ пройдена')
  else console.log('ИТОГ: все проверки пройдены')
}

main().then(
  // Выход явный (пул базы иначе держит процесс), но с тем кодом, что выставили проверки:
  // голый `exit(0)` затирал бы провал `--selfcheck`.
  () => process.exit(process.exitCode ?? 0),
  (e) => {
    console.error(e)
    process.exit(1)
  },
)
