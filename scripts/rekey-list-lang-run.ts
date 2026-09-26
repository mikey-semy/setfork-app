// Точка входа перекладки ключей языка (ADR-0030). Без флага — план, с `--apply` — запись.
//
// Импорты тянут серверные модули (`server-only`), поэтому запуск — с условием react-server:
//   NODE_OPTIONS=--conditions=react-server npx tsx scripts/rekey-list-lang-run.ts [--apply]
// Нужны DATABASE_URL и доступ к ядру (SETFORK_CORE_URL, SETFORK_CORE_ADDR, SETFORK_CORE_TOKEN):
// запись идёт новой версией через ядро.
import 'dotenv/config'
import { applyRekey, planRekey } from './rekey-list-lang'

async function main() {
  if (process.argv.includes('--apply')) {
    const done = await applyRekey()
    for (const r of done) console.log(r.error ? `ОТКАЗ  ${r.ref}: ${r.error}` : `v${r.version}  ${r.ref}: полей ${r.moved}`)
    const failed = done.filter((r) => r.error).length
    console.log(`\nпереложено списков: ${done.length - failed}, отказов: ${failed}`)
    process.exit(failed ? 1 : 0)
  }
  const plan = await planRekey()
  for (const r of plan) console.log(`${r.lang}  v${r.version}  ${r.ref}: переложить ${r.moved}${r.ambiguous ? `, спорных ${r.ambiguous}` : ''}`)
  const moving = plan.filter((r) => r.moved)
  console.log(
    `\nПЛАН (ничего не записано): списков к перекладке ${moving.length}, полей ${moving.reduce((n, r) => n + r.moved, 0)};` +
      ` спорных полей ${plan.reduce((n, r) => n + r.ambiguous, 0)} — остаются как есть. Применить: --apply`,
  )
  process.exit(0)
}

main().catch((e) => {
  console.error('[rekey] ошибка:', e)
  process.exit(1)
})
