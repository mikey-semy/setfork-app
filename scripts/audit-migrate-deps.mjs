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
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

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

// npm audit возвращает ненулевой код, когда что-то нашёл, — читаем вывод, а не статус.
let raw = ''
try {
  raw = execFileSync('npm', ['audit', '--json'], { encoding: 'utf8', shell: process.platform === 'win32' })
} catch (e) {
  raw = e.stdout ?? ''
}
if (!raw) {
  console.error('::error::npm audit не дал вывода — гейт инструментов миграции не отработал')
  process.exit(1)
}

const vulns = JSON.parse(raw).vulnerabilities ?? {}
const bad = Object.values(vulns).filter((v) => ['high', 'critical'].includes(v.severity) && reach.has(v.name))

if (!bad.length) {
  console.log(`Инструменты миграции (${ROOTS.join(', ')} и их ${reach.size - ROOTS.length} зависимостей): high/critical нет.`)
  process.exit(0)
}
console.error('::error::в инструментах, которые прод-образ миграции ЗАПУСКАЕТ, есть high/critical:')
for (const v of bad) console.error(`  ${v.name} (${v.severity}) — ${(v.via ?? []).map((x) => (typeof x === 'string' ? x : x.title)).join('; ')}`)
process.exit(1)
