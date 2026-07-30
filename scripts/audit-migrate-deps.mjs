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

// npm audit возвращает ненулевой код, когда НАШЁЛ уязвимости, — поэтому читаем вывод, а
// не статус. Но ненулевой код бывает и от операционного сбоя (403 реестра, нет сети): в
// таком случае в stdout прилетает {message, statusCode} без vulnerabilities, и «пустой»
// разбор молча означал бы «всё чисто» — гейт обходился бы сам собой (P2 из авто-ревью).
// Поэтому отчёт проверяем на форму, а не доверяем факту наличия вывода.
let raw = ''
try {
  raw = execFileSync('npm', ['audit', '--json'], { encoding: 'utf8', shell: process.platform === 'win32' })
} catch (e) {
  raw = e.stdout ?? ''
}

let report
try {
  report = JSON.parse(raw)
} catch {
  report = null
}
const looksLikeReport = !!report && typeof report.vulnerabilities === 'object' && report.vulnerabilities !== null && !!report.metadata
if (!looksLikeReport) {
  // Технический литерал для лога CI, не UI-текст: пользователю он не показывается.
  // eslint-disable-next-line no-restricted-syntax -- строка уходит в вывод джобы, не в интерфейс
  const why = report?.error?.summary ?? report?.message ?? (raw ? `неожиданный вывод: ${raw.slice(0, 200)}` : 'пустой вывод')
  console.error(`::error::npm audit не дал отчёта (${why}) — гейт инструментов миграции НЕ отработал`)
  process.exit(1)
}

const vulns = report.vulnerabilities
const bad = Object.values(vulns).filter((v) => ['high', 'critical'].includes(v.severity) && reach.has(v.name))

if (!bad.length) {
  console.log(`Инструменты миграции (${ROOTS.join(', ')} и их ${reach.size - ROOTS.length} зависимостей): high/critical нет.`)
  process.exit(0)
}
console.error('::error::в инструментах, которые прод-образ миграции ЗАПУСКАЕТ, есть high/critical:')
for (const v of bad) console.error(`  ${v.name} (${v.severity}) — ${(v.via ?? []).map((x) => (typeof x === 'string' ? x : x.title)).join('; ')}`)
process.exit(1)
