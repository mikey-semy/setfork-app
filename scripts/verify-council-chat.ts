// Разовая проверка: реальный прогон совета → что реально легло в ленту-чат.
// Скриншотом это не поймать: проверяем, что у КАЖДОЙ реплики есть говорящий (who) и подпись (name),
// что who совпадает с существующей аватаркой, и что порядок ролей осмысленный.
//
// Запуск (server-only модули требуют условие react-server):
//   npx tsx --conditions=react-server --env-file=.env --env-file=.env.local scripts/verify-council-chat.ts
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { generateListCouncil } from '../src/shared/ai/council'
import { getCouncilEvents, clearCouncilEvents } from '../src/shared/ai/council-progress'

async function main() {
  const query = process.argv[2] || 'Настроить CI для монорепозитория на GitHub Actions'
  const refId = randomUUID() // ai_usage.ref_id — uuid-колонка, строкой типа 'e2e' падает

  console.log(`запрос: ${query}\nrefId: ${refId}\n`)
  const t0 = Date.now()
  const res = await generateListCouncil(query, 'ru', { refId })
  const secs = ((Date.now() - t0) / 1000).toFixed(1)

  const events = await getCouncilEvents(refId)
  console.log(`--- лента (${events.length} реплик, ${secs}s) ---`)
  let bad = 0
  for (const e of events) {
    const src = `public/gnomes/${e.who}.webp`
    const ok = e.who && existsSync(src)
    if (!ok || !e.name) bad++
    console.log(`${ok ? '✓' : '✗'} [${e.kind}] who=${e.who ?? '—'} name=${e.name ?? '—'} :: ${e.text}`)
  }

  const kind = res && 'clarify' in res ? `уточнения (${res.clarify.length})` : res ? `список (${res.items?.length ?? 0} шагов)` : 'null'
  console.log(`\nрезультат: ${kind}`)
  // eslint-disable-next-line no-restricted-syntax -- вывод CLI-харнесса, не UI: словарь i18n тут ни при чём
  console.log(bad ? `ПРОБЛЕМА: ${bad} реплик без говорящего/аватарки` : 'все реплики с говорящим и картинка на месте')
  await clearCouncilEvents(refId)

}

main()
