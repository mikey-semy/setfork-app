/**
 * Окружение для интеграционных тестов на СВОЕЙ машине: Postgres + Rust-ядро.
 *
 * Зачем скрипт, а не абзац в документации: без ядра `npm run test:integration`
 * падает пачками (`referenced row missing`, `ECONNREFUSED`) — с Ф1 запись версий
 * идёт ТОЛЬКО через ядро. Раньше это выглядело как «локально прогнать нельзя,
 * проверка за CI», и правки тестов уезжали в CI непроверенными, занимая по 25
 * минут на попытку. Поднять то же самое локально — три докер-команды, но помнить
 * их наизусть никто не обязан.
 *
 * Отличие от CI: там раннер сам внутри докер-сети и ходит к контейнерам по
 * именам. Здесь тесты идут НА ХОСТЕ, поэтому порты пробрасываются наружу.
 *
 *   npx tsx scripts/itest-env.ts up     # поднять и накатить схему
 *   npx tsx scripts/itest-env.ts down   # убрать за собой
 *   npx tsx scripts/itest-env.ts env    # напечатать переменные для прогона
 */
import { execFileSync, spawnSync } from 'node:child_process'

const NET = 'sf-itest'
const PG = `pg-${NET}`
const CORE = `core-${NET}`
const IMAGE = process.env.SETFORK_CORE_IMAGE ?? 'ghcr.io/mikey-semy/setfork-core:latest'

// Порты на хосте: НЕ 5432/50051, чтобы не столкнуться с прод-подобными стендами
// и рабочей базой разработки, которые у людей уже заняты.
const PG_PORT = process.env.ITEST_PG_PORT ?? '55432'
const CORE_PORT = process.env.ITEST_CORE_PORT ?? '55051'

const DATABASE_URL = `postgresql://ci:ci@127.0.0.1:${PG_PORT}/ci`
const CORE_ADDR = `127.0.0.1:${CORE_PORT}`

const docker = (args: string[], quiet = true) => {
  const r = spawnSync('docker', args, { encoding: 'utf8' })
  if (r.status !== 0 && !quiet) throw new Error(`docker ${args.join(' ')}\n${r.stderr}`)
  return (r.stdout ?? '').trim()
}

const out = (s: string) => process.stdout.write(`${s}\n`)

function waitFor(what: string, check: () => boolean, seconds = 90) {
  for (let i = 0; i < seconds; i++) {
    if (check()) return
    execFileSync(process.execPath, ['-e', 'setTimeout(()=>{},1000)'])
  }
  throw new Error(`${what} не поднялся за ${seconds}с — посмотри docker logs`)
}

function up() {
  docker(['network', 'create', NET])
  docker(['rm', '-f', PG, CORE])

  out('Postgres…')
  docker(
    ['run', '-d', '--name', PG, '--network', NET, '-p', `${PG_PORT}:5432`,
     '-e', 'POSTGRES_USER=ci', '-e', 'POSTGRES_PASSWORD=ci', '-e', 'POSTGRES_DB=ci',
     'pgvector/pgvector:pg16'],
    false,
  )
  waitFor('Postgres', () => spawnSync('docker', ['exec', PG, 'pg_isready', '-U', 'ci', '-d', 'ci']).status === 0)

  // Схема накатывается ДО ядра: на старте оно ходит в базу.
  out('схема (db:init)…')
  const init = spawnSync('npm', ['run', 'db:init'], { stdio: 'inherit', shell: true, env: { ...process.env, DATABASE_URL } })
  if (init.status !== 0) throw new Error('db:init не прошёл — схему не накатили, ядро поднимать бессмысленно')

  out('ядро…')
  docker(['pull', IMAGE])
  docker(
    ['run', '-d', '--name', CORE, '--network', NET, '-p', `${CORE_PORT}:50051`,
     '-e', `DATABASE_URL=postgresql://ci:ci@${PG}:5432/ci`, '-e', 'SETFORK_ALLOW_INSECURE=1', IMAGE],
    false,
  )
  // Готовность берём из healthcheck образа, а НЕ из строки в логе: строка
  // зависит от языка сборки («слушает» / «listening»), и стоит ей смениться —
  // ожидание превращается в молчаливый сон до конца таймаута. Ровно это сейчас
  // и происходит в ci.yml, где ждут подстроку «слушает».
  waitFor('Ядро', () => docker(['inspect', '--format', '{{.State.Health.Status}}', CORE]) === 'healthy')

  out('\nготово. Прогон:')
  printEnv()
}

function printEnv() {
  out(`  DATABASE_URL=${DATABASE_URL} \\`)
  out(`  SETFORK_CORE_URL=1 SETFORK_CORE_ADDR=${CORE_ADDR} \\`)
  out('  npm run test:integration')
}

function down() {
  docker(['rm', '-f', PG, CORE])
  docker(['network', 'rm', NET])
  out('окружение убрано')
}

const cmd = process.argv[2] ?? 'up'
if (cmd === 'up') up()
else if (cmd === 'down') down()
else if (cmd === 'env') printEnv()
else {
  out('используй: up | down | env')
  process.exit(1)
}
