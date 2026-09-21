// Проверка узды порчей кода: ловит ли тест дефект, ради которого написан.
//
// Зелёный набор доказывает, что код проходит тесты. Он НЕ доказывает, что тесты
// заметят поломку: тест, написанный мимо, остаётся зелёным и на сломанном коде —
// такое ловили в этом репозитории не раз. Единственное доказательство — внести
// поломку и увидеть красный.
//
// Делалось это руками и всякий раз заново, а поделка жила в /tmp. Здесь тот же
// приём, но порча описана рядом с тестом и прогоняется как обычная проверка.
//
// Запуск:  node scripts/mutate.mjs tests/core/domain/destructive-command.mutants.json
//          npm run mutate -- <паспорт> [--only <часть имени>]
//
// Паспорт — JSON рядом с тестом:
//   { "target": "src/...ts", "tests": ["tests/...test.ts"], "config": "…?",
//     "mutants": [ { "name": "зачем эта порча", "from": "кусок кода", "to": "чем заменить" } ] }
//
// Исход мутанта:
//   ✓ убит      — упал хотя бы один тест: узда работает
//   ✗ ВЫЖИЛ     — набор зелёный на сломанном коде: узды нет, хоть тест и есть
//   ✗ ЯКОРЬ     — `from` не найден или найден дважды: паспорт протух за кодом
//   ✗ НЕ СОБРАН — порча сломала сборку, а не поведение: такая проверка ничего не значит
//
// Провал любого рода — ненулевой код возврата. Все четыре исхода проверены живыми
// дефектами 21.09.2026: счётчику, который показывает только зелёное, верить нельзя.
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

const ROOT = resolve(dirname(new URL(import.meta.url).pathname), '..')
const args = process.argv.slice(2)
const only = args.includes('--only') ? args[args.indexOf('--only') + 1] : null
const passportPath = args.find((a) => !a.startsWith('--') && a !== only)

if (!passportPath) {
  process.stderr.write('нужен путь к паспорту: node scripts/mutate.mjs <файл>.mutants.json\n')
  process.exit(2)
}

const passport = JSON.parse(readFileSync(resolve(ROOT, passportPath), 'utf8'))
const target = resolve(ROOT, passport.target)
const tests = passport.tests.map((t) => resolve(ROOT, t))

// ⚠️ Оригинал прячется ВНЕ репозитория: восстановление не должно зависеть от git, иначе
// прогон по незакоммиченной правке (а чаще всего проверяют именно её) затрёт саму правку.
const stash = join(tmpdir(), 'setfork-mutate', `${createHash('sha1').update(target).digest('hex').slice(0, 12)}.bak`)
mkdirSync(dirname(stash), { recursive: true })

// Похоронка от прошлого прогона означает, что тот умер, не восстановив файл. Молча
// перезаписать её — значит похоронить настоящий исходник под мутантом навсегда.
if (existsSync(stash)) {
  process.stderr.write(
    `в ${stash} лежит оригинал от прошлого прогона — он не завершился.\n` +
      `Сначала верните файл:  cp ${stash} ${target} && rm ${stash}\n`,
  )
  process.exit(2)
}

const original = readFileSync(target, 'utf8')
writeFileSync(stash, original)

/** Прогон набора. Возвращает, что именно случилось, — «красный» бывает трёх разных смыслов. */
function run() {
  const cmd = ['run', '--reporter=json', ...(passport.config ? ['--config', passport.config] : []), ...tests]
  let out = ''
  try {
    out = execFileSync(join(ROOT, 'node_modules/.bin/vitest'), cmd, {
      cwd: ROOT,
      encoding: 'utf8',
      timeout: passport.timeoutMs ?? 600_000,
      maxBuffer: 64 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  } catch (e) {
    // Красный набор — это штатный выход 1, а не сбой: отчёт всё равно в stdout.
    out = e.stdout ?? ''
    if (!out) return { failedTests: 0, brokenSuite: true, names: [], why: (e.message ?? '').split('\n')[0] }
  }
  const at = out.indexOf('{')
  if (at < 0) return { failedTests: 0, brokenSuite: true, names: [], why: 'vitest не отдал отчёт' }
  let report
  try {
    report = JSON.parse(out.slice(at))
  } catch {
    return { failedTests: 0, brokenSuite: true, names: [], why: 'отчёт vitest не разобрался' }
  }
  const asserts = report.testResults?.flatMap((r) => r.assertionResults ?? []) ?? []
  const names = asserts.filter((a) => a.status === 'failed').map((a) => a.fullName)
  return {
    failedTests: names.length,
    // Набор красный, но ни один ТЕСТ не падал — значит не собрался сам файл.
    brokenSuite: names.length === 0 && (report.numFailedTestSuites ?? 0) > 0,
    names,
  }
}

const restore = () => {
  writeFileSync(target, original)
  try {
    renameSync(stash, `${stash}.done`)
  } catch {
    /* убрать похоронку не вышло — файл уже верен, это не повод падать */
  }
}
// Обрыв по Ctrl+C оставил бы в дереве мутанта: восстанавливаем и на нём.
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => (restore(), process.exit(130)))

let failures = 0
try {
  // ⚠️ Без этого шага стенд врёт: на красной базе мутант «убивает» тест, который и без
  // него лежал, и любая порча выглядит пойманной.
  process.stdout.write('база (без порчи)… ')
  const base = run()
  if (base.failedTests > 0 || base.brokenSuite) {
    process.stdout.write('КРАСНАЯ\n')
    for (const n of base.names.slice(0, 5)) process.stdout.write(`   ✗ ${n}\n`)
    if (base.why) process.stdout.write(`   ${base.why}\n`)
    process.stderr.write('\nНа красной базе мутации не значат ничего. Сначала зелёный набор.\n')
    process.exit(2)
  }
  process.stdout.write('зелёная\n\n')

  const chosen = passport.mutants.filter((m) => !only || m.name.includes(only))
  for (const m of chosen) {
    const hits = original.split(m.from).length - 1
    if (hits !== 1) {
      // Ноль — паспорт отстал от кода. Больше одного — заменится не то место, а какое
      // именно, знать неоткуда: оба случая делают проверку бессмысленной.
      process.stdout.write(`✗ ЯКОРЬ  ${m.name}\n         кусок встречается ${hits} раз, нужен ровно один\n`)
      failures++
      continue
    }
    writeFileSync(target, original.replace(m.from, m.to))
    const r = run()
    if (r.brokenSuite) {
      process.stdout.write(`✗ НЕ СОБРАН  ${m.name}\n             порча ломает сборку — так проверяется компилятор, а не тест\n`)
      failures++
    } else if (r.failedTests === 0) {
      process.stdout.write(`✗ ВЫЖИЛ  ${m.name}\n         набор зелёный на испорченном коде\n`)
      failures++
    } else {
      process.stdout.write(`✓ убит   ${m.name}  (${r.failedTests})  ${r.names[0] ?? ''}\n`)
    }
    writeFileSync(target, original)
  }

  process.stdout.write(`\n${chosen.length - failures}/${chosen.length} порч поймано\n`)
} finally {
  restore()
}

process.exit(failures > 0 ? 1 : 0)
