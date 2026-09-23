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

const HERE = join(dirname(fileURLToPath(import.meta.url)), 'lib', 'gnome-routing')
/** Сколько запросов к Jev одновременно — как в исходном прогоне HQ (`run.mts`). */
const CONCURRENCY = 4

type Gnome = { id: string; about: string; domains: string[]; candidate?: boolean }
type Item = { id: string; list: string; n: number; kind: string; section: string | null; text: string; gold: string; ok: string[]; why: string }
type ListMeta = { ref: string; title: string; tags: string[] }
type Pred = { id: string; pred: string; confidence?: number; probs?: Record<string, number>; inputTokens?: number; cost?: number; model?: string; error?: string }

const roster: Gnome[] = JSON.parse(readFileSync(join(HERE, 'gnomes.json'), 'utf8')).gnomes
const ds = JSON.parse(readFileSync(join(HERE, 'dataset.json'), 'utf8')) as { lists: Record<string, ListMeta>; items: Item[] }

// ── базовая линия: ядро tenderForTags; никто не подошёл — универсал, как у вызывающих
function baseline(tags: string[]): string {
  return rankByAffinity(tags, roster)[0]?.id ?? 'generalist'
}

// ── Jev: один вопрос choice на пункт. Разведчик — роль, а не ремесло: в кандидатах его нет.
const candidates = roster.filter((g) => g.candidate !== false)
const criteria = Object.fromEntries(
  candidates.map((g) => [
    g.id,
    g.domains.includes('*')
      ? `${g.about}. Pick ONLY when none of the other specialists' crafts fits the item.`
      : `${g.about}. Craft: ${g.domains.join(', ')}.`,
  ]),
)

function stateOf(it: Item): string {
  const l = ds.lists[it.list]
  return [`Список: ${l.title}`, `Теги списка: ${l.tags.join(', ')}`, it.section ? `Раздел: ${it.section}` : null, `Пункт: ${it.text}`]
    .filter(Boolean)
    .join('\n')
}

const QUESTION = {
  type: 'choice' as const,
  instructions:
    'A reader wants to dig deeper into THIS item of the list (not the list as a whole). Which specialist is the best guide for this specific item?',
  criteria,
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
      lines.push(`| ≥ ${t} | ${s.length}/${withConf.length} | ${pct(s.filter((r) => r.ok).length, s.length)} |`)
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

  if (args.includes('--selfcheck')) {
    await selfcheck()
    return
  }

  if (args.includes('--dry')) {
    const { decideModel } = await import('../src/shared/ai/decide')
    console.log(JSON.stringify({ model: await decideModel(), state: stateOf(ds.items[0]), questions: { guide: QUESTION } }, null, 2))
    return
  }

  const base: Pred[] = ds.items.map((it) => ({ id: it.id, pred: baseline(ds.lists[it.list].tags) }))
  const report = [`# Результаты — ${new Date().toISOString().slice(0, 10)}`, '', score('Базовая линия: tenderForTags (теги списка × домены)', base)]

  if (!args.includes('--baseline')) {
    const { decide, decideModel } = await import('../src/shared/ai/decide')
    const model = await decideModel()
    // Один uuid на прогон (`ai_usage.ref_id` — uuid): по нему расход прогона сверяется с журналом.
    const runId = randomUUID()
    const t0 = Date.now()
    const jev: Pred[] = await pool(ds.items, CONCURRENCY, async (it) => {
      const r = await decide({ state: stateOf(it), questions: { guide: QUESTION }, refType: 'gnome-routing-eval', refId: runId })
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
    const tokens = jev.reduce((s, p) => s + (p.inputTokens ?? 0), 0)
    // Стоимость — ТОЛЬКО из ответов (`usage.cost`), без оценки по прайсу: так требует
    // задание, и так видно, если провайдер перестал её присылать (сумма станет нулём).
    const billed = jev.reduce((s, p) => s + (p.cost ?? 0), 0)
    const errors = jev.filter((p) => p.error)
    report.push(score(`Jev (${answered}, через OpenRouter Decisions)`, jev))
    report.push(
      `Прогон: ${jev.length} запросов за ${secs.toFixed(1)} с, ${tokens} входных токенов, $${billed.toFixed(5)} по \`usage.cost\` из ответов, ошибок: ${errors.length}.`,
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
  if (ok) {
    const g = ok.answers.guide
    console.log(`1. Jev ответил под этой политикой: ${ok.model}, выбор ${g.type === 'choice' ? g.choice : g.type}, $${ok.usage.cost}`)
  } else {
    console.log('1. ⛔ Jev НЕ ответил под этой политикой — смотри предупреждение [decide] выше')
  }

  let threw = false
  let res: unknown = 'не звали'
  try {
    res = await decide({ state: 'x', questions: { guide: QUESTION }, model: 'typesafe/no-such-model', refType: 'gnome-routing-selfcheck', refId: ref })
  } catch {
    threw = true
  }
  console.log(`2. несуществующая модель: результат ${JSON.stringify(res)}`)
  if (threw) console.log('   ⛔ исключение — вызывающий упал бы')
  else console.log('   исключения нет')

  const rows = await db
    .select({ model: aiUsage.model, outcome: aiUsage.outcome, cost: aiUsage.costUsd, feature: aiUsage.feature })
    .from(aiUsage)
    .where(and(eq(aiUsage.refType, 'gnome-routing-selfcheck'), eq(aiUsage.refId, ref)))
    .orderBy(desc(aiUsage.createdAt))
  console.log('строки ai_usage этого прогона:')
  for (const r of rows) console.log(`   ${r.feature} · ${r.model} · ${r.outcome} · $${r.cost}`)
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e)
    process.exit(1)
  },
)
