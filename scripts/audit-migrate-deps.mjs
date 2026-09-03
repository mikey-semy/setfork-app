// Аудит инструментов, которые реально ИСПОЛНЯЮТСЯ на проде в образе миграции.
//
// Гейт `npm audit --omit=dev` смотрит только на зависимости приложения — и правильно
// делает: dev-цепочка линтера на прод не уезжает. Но образ `migrate` (Dockerfile, цель
// migrate) ставит ВСЕ зависимости и запускает `tsx scripts/migrate-push.ts`, который
// зовёт `drizzle-kit`. То есть tsx и drizzle-kit объявлены в devDependencies, а
// выполняются на проде с доступом к боевой БД — и из-под гейта выпадали (P2 из
// авто-ревью #585).
//
// Здесь считаем замыкание зависимостей этих двух пакетов по lock-файлу и падаем, если
// в нём есть high/critical из `npm audit`. Всё остальное dev-хозяйство по-прежнему
// только печатается.
//
// ⚠️ НЕДОСТУПНОСТЬ СЕРВИСА АУДИТА БОЛЬШЕ НЕ ВАЛИТ ЭТУ ДЖОБУ — она предупреждает.
// Блокирует находка, а не молчание реестра: за сутки 02–03.09.2026 гейт дважды покраснел
// при «found 0 vulnerabilities», и оба раза причина была на стороне сервиса. Красный,
// который не про нас, приучает не читать красный вообще — а блокирующая половина от
// этого обязана остаться настоящей. Поэтому: повторы, и только потом предупреждение,
// которое НЕ выдаёт себя за «чисто» (см. scripts/lib/audit-report.mjs).
import { readFileSync } from 'node:fs'
import { fetchAuditReport, highOrCritical } from './lib/audit-report.mjs'

/** Инструменты, которые прод-образ миграции реально запускает. */
const ROOTS = ['tsx', 'drizzle-kit']

/** Пакеты, до которых дотягиваются ROOTS по lock-файлу (включая их самих). */
function closure(lock) {
  const nodes = lock.packages ?? {}
  const nameOf = (path) => (path.startsWith('node_modules/') ? path.slice('node_modules/'.length) : path)
  const byName = new Map()
  for (const [path, node] of Object.entries(nodes)) {
    if (!path) continue
    byName.set(nameOf(path).replace(/^.*node_modules\//, ''), node)
  }
  const seen = new Set()
  const queue = [...ROOTS]
  while (queue.length) {
    const name = queue.shift()
    if (seen.has(name)) continue
    seen.add(name)
    const node = byName.get(name)
    if (!node) continue
    for (const dep of Object.keys({ ...(node.dependencies ?? {}), ...(node.optionalDependencies ?? {}) })) queue.push(dep)
  }
  return seen
}

const lock = JSON.parse(readFileSync('package-lock.json', 'utf8'))
const reach = closure(lock)

const gate = fetchAuditReport()
if (!gate.ok) {
  // Технические литералы ниже уходят в лог CI, а не в интерфейс.
  console.log(`::warning::сервис аудита не отдал отчёт (${gate.why}) — гейт инструментов миграции НЕ отработал; уязвимости при этом НЕ проверены`)
  process.exit(0)
}

const bad = highOrCritical(gate.report, reach)
if (!bad.length) {
  console.log(`Инструменты миграции (${ROOTS.join(', ')} и их ${reach.size - ROOTS.length} зависимостей): high/critical нет.`)
  process.exit(0)
}
console.error('::error::в инструментах, которые прод-образ миграции ЗАПУСКАЕТ, есть high/critical:')
for (const v of bad) console.error(`  ${v.name} (${v.severity}) — ${(v.via ?? []).map((x) => (typeof x === 'string' ? x : x.title)).join('; ')}`)
process.exit(1)
