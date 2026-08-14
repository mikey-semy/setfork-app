/**
 * Живой бенч юнит-цены совета НА ПРОД-СОСТАВЕ вызовов (Горизонт 1, п.2):
 * реальный generateListCouncil (стюард + шлифовка реплик + эксперты с
 * прецедентами/правилами/памятью + критик + старейшина) → журнал ai_usage →
 * цена по НАШЕМУ прайсу (yandex-pricing/gigachat), латентность, отказы.
 *
 * Запуск (Яндекс-настройки должны быть в app_settings БД из DATABASE_URL):
 *   npx tsx --conditions=react-server --env-file=.env --env-file=.env.local scripts/council-bench-live.ts [N]
 *
 * Расход реальный (ключ провайдера) — кап N советов, дефолт 6.
 */
import { randomUUID } from 'node:crypto'
import { desc, eq } from 'drizzle-orm'
import { db, aiUsage } from '../src/shared/db'
import { generateListCouncil } from '../src/shared/ai/council'
import { estimateCostUsd } from '../src/shared/ai/pricing'

const RUB_PER_USD = Number(process.env.SETFORK_RUB_PER_USD ?? 90)

const PROMPTS: { q: string; lang: 'ru' | 'en' }[] = [
  { q: 'Рецепт домашнего маршмеллоу', lang: 'ru' },
  { q: 'Что взять в поход на 3 дня осенью', lang: 'ru' },
  { q: 'Настроить бэкапы Postgres на VPS', lang: 'ru' },
  { q: 'Как выбрать беговые кроссовки', lang: 'ru' },
  { q: 'Deploy a Next.js app with zero downtime', lang: 'en' },
  { q: 'Weekly meal prep for two, high protein', lang: 'en' },
]

async function main() {
  const n = Math.min(Number(process.argv[2] ?? 6) || 6, PROMPTS.length)
  let delivered = 0
  let totalCalls = 0
  let totalOk = 0
  let totalUsd = 0
  let totalMs = 0
  const perRun: string[] = []

  for (const { q, lang } of PROMPTS.slice(0, n)) {
    const refId = randomUUID()
    const t0 = Date.now()
    const res = await generateListCouncil(q, lang, { refId, feature: 'generate', refType: 'council' })
    const ms = Date.now() - t0
    const ok = !!res && !('clarify' in res)
    if (ok) delivered++
    totalMs += ms

    const rows = await db.select().from(aiUsage).where(eq(aiUsage.refId, refId)).orderBy(desc(aiUsage.createdAt))
    let usd = 0
    let fails = 0
    for (const r of rows) {
      totalCalls++
      if (r.outcome === 'ok') totalOk++
      else fails++
      usd += r.costUsd && Number(r.costUsd) > 0 ? Number(r.costUsd) : estimateCostUsd(r.provider ?? 'yandex', r.model, r.inputTokens, r.outputTokens)
    }
    totalUsd += usd
    perRun.push(
      `${ok ? 'OK ' : 'FAIL'} ${(ms / 1000).toFixed(0).padStart(3)}s calls=${rows.length} fails=${fails} ~${(usd * RUB_PER_USD).toFixed(2)}₽  «${q}»`,
    )
  }

  console.log(perRun.join('\n'))
  console.log('\n──── СВОДКА ────')
  console.log(`советов: ${n}, доставлено: ${delivered} (${((delivered / n) * 100).toFixed(0)}%)`)
  console.log(`вызовов/совет: ${(totalCalls / n).toFixed(1)}, success вызовов: ${totalCalls ? ((totalOk / totalCalls) * 100).toFixed(0) : 0}%`)
  console.log(`средняя латентность: ${(totalMs / n / 1000).toFixed(0)}с`)
  console.log(`цена/совет: ~${((totalUsd / n) * RUB_PER_USD).toFixed(2)}₽ (~$${(totalUsd / n).toFixed(4)}) при курсе ${RUB_PER_USD}`)
  console.log(`цена/ДОСТАВЛЕННЫЙ: ~${delivered ? ((totalUsd / delivered) * RUB_PER_USD).toFixed(2) : '—'}₽`)
  process.exit(0)
}

void main()
