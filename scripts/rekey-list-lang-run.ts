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
    // Темп — доля ОБЩЕГО лимита ядра на запись версий (SETFORK_RPC_RPM_HEAVY у ядра, по
    // умолчанию 60 в минуту на весь прод): скрипт берёт четверть, остальное — людям.
    const perMinute = Number(process.env.SETFORK_RPC_RPM_HEAVY || 60) / 4
    const done = await applyRekey({
      pauseMs: Math.ceil(60_000 / perMinute),
      onResult: (r) => console.log(r.error ? `ОТКАЗ  ${r.ref}: ${r.error}` : `v${r.version}  ${r.ref}: полей ${r.moved}`),
    })
    const failed = done.filter((r) => r.error).length
    console.log(`\nпереложено списков: ${done.length - failed}, отказов: ${failed}`)
    process.exit(failed ? 1 : 0)
  }
  const plan = await planRekey()
  // Образец текста — чтобы глазом проверить, что под чужим ключом лежит именно оригинал.
  const cut = (t?: string) => (t ? ` «${t.length > 50 ? `${t.slice(0, 50)}…` : t}»` : '')
  for (const r of plan) {
    const why = r.held ? `  НЕ ТРОГАЕМ: список переводили (с переводом ${r.translated}, спорных ${r.ambiguous})` : ''
    console.log(`${r.lang}  v${r.version}  ${r.ref}: полей ${r.moved}${cut(r.sample)}${why}`)
  }
  const moving = plan.filter((r) => !r.held)
  console.log(
    `\nПЛАН (ничего не записано): списков к перекладке ${moving.length}, полей ${moving.reduce((n, r) => n + r.moved, 0)};` +
      ` не трогаем переведённых списков ${plan.length - moving.length}. Применить: --apply`,
  )
  process.exit(0)
}

main().catch((e) => {
  console.error('[rekey] ошибка:', e)
  process.exit(1)
})
