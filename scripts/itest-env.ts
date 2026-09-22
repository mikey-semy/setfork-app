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
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'

// Имена ВЫВОДЯТСЯ ИЗ ПОРТОВ, а не фиксированы: иначе вторая сессия, поднимая своё
// окружение на своём порту, сносила бы контейнеры первой — `up` начинается с
// `docker rm -f` по имени. Ровно так 11.08 одна сессия увела базу у другой посреди
// прогона, и падение выглядело как «ECONNREFUSED» на ровном месте.
const PG_PORT = process.env.ITEST_PG_PORT ?? '55432'
const CORE_PORT = process.env.ITEST_CORE_PORT ?? '55051'
const NET = `sf-itest-${PG_PORT}`
const PG = `pg-${NET}`
const CORE = `core-${NET}`
const IMAGE = process.env.SETFORK_CORE_IMAGE ?? 'ghcr.io/mikey-semy/setfork-core:latest'

// Порты на хосте: НЕ 5432/50051, чтобы не столкнуться с прод-подобными стендами
// и рабочей базой разработки, которые у людей уже заняты.

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

/**
 * Порт, на который контейнер ядра РЕАЛЬНО проброшен, — или `null`, если его нет.
 *
 * ⚠️ Имя ядра выводится из порта БАЗЫ, не из своего: сменив `ITEST_CORE_PORT` при
 * прежнем `ITEST_PG_PORT`, получаешь тот же контейнер со старым пробросом. Проверка
 * «healthy» его пропускала, а `printEnv` объявлял новый адрес, где никто не слушает
 * (находка авто-ревью 22.09.2026).
 */
function corePublishedPort(): string | null {
  const line = docker(['port', CORE, '50051/tcp']).split('\n')[0] ?? ''
  const m = /:(\d+)$/.exec(line.trim())
  return m ? m[1] : null
}

/** Существует ли контейнер — безотносительно того, отвечает ли он. */
function exists(name: string): boolean {
  return spawnSync('docker', ['inspect', '--format', '{{.Name}}', name]).status === 0
}

/**
 * ГОТОВО ЛИ ОКРУЖЕНИЕ ЦЕЛИКОМ, а не только база.
 *
 * ⚠️ Проверять один Postgres мало: `db:init` мог упасть, ядро — свалиться, а порт ядра
 * поменяться при неизменном порте базы. Тогда `up` сказал бы «уже поднято» и вернул
 * переменные для окружения, в котором нет схемы или нет ядра, — прогон упал бы дальше и
 * непонятно где (находка авто-ревью 22.09.2026).
 *
 * Схему проверяем существованием таблицы, а не фактом «psql отвечает»: пустая база
 * отвечает так же бодро, как накатанная.
 */
function ready(): boolean {
  const pg = spawnSync('docker', ['exec', PG, 'psql', '-U', 'ci', '-d', 'ci', '-c', 'select 1']).status === 0
  if (!pg) return false
  const schema =
    spawnSync('docker', ['exec', PG, 'psql', '-U', 'ci', '-d', 'ci', '-tAc', "select to_regclass('public.templates') is not null"])
      .stdout?.toString()
      .trim() === 't'
  const core = docker(['inspect', '--format', '{{.State.Health.Status}}', CORE]) === 'healthy'
  return schema && core
}

/**
 * ОТПЕЧАТОК СХЕМЫ — то, из чего `db:init` собирает базу: сама схема drizzle и бутстрап
 * вокруг неё (расширения, канон поиска из файла миграции, который бутстрап исполняет).
 *
 * Ставится меткой на контейнер базы при создании. Сравнение меток ничего в базе не
 * меняет — в отличие от «накатить ещё раз и посмотреть»: `drizzle-kit push --force` на
 * окружении, по которому идёт чужой прогон, переименует и удалит колонки у него из-под
 * ног (находка авто-ревью к прошлой редакции, где так и было сделано).
 */
const SCHEMA_INPUTS = ['src/shared/db/schema.ts', 'scripts/db-bootstrap.ts', 'drizzle/0028_search_fts.sql']
const SCHEMA_LABEL = 'sf.itest.schema'

function schemaFingerprint(): string {
  const h = createHash('sha256')
  for (const f of SCHEMA_INPUTS) h.update(f).update(readFileSync(f))
  return h.digest('hex').slice(0, 16)
}

/**
 * ТО ЛИ ЭТО ОКРУЖЕНИЕ, КОТОРОЕ ПРОСЯТ, — а не «живое ли оно».
 *
 * Имена контейнеров выводятся из порта БАЗЫ, поэтому под тем же именем может стоять
 * окружение, поднятое с другим портом ядра, другим образом или другой схемой. Проба
 * `ready()` все три случая пропускала: контейнеры здоровы — значит, «готово», и прогон
 * шёл по чужому ядру или отставшей базе молча (три находки авто-ревью к #956).
 *
 * Расхождение — отказ с объяснением, а не снос и не правка на месте: окружением может
 * пользоваться идущий прогон, ради него вся эта проверка и заведена. Пересоздаёт человек,
 * нарочно: `up --recreate`.
 *
 * ⚠️ Образ сверяется по ИМЕНИ. Тот же тег `:latest`, обновившийся в реестре, отсюда не
 * виден — новый образ подтягивается только пересозданием.
 */
function mismatches(): string[] {
  const out: string[] = []
  if (exists(CORE)) {
    const port = corePublishedPort()
    if (port && port !== CORE_PORT) out.push(`ядро проброшено на ${port}, а просят ${CORE_PORT}`)
    const image = docker(['inspect', '--format', '{{.Config.Image}}', CORE])
    if (image && image !== IMAGE) out.push(`ядро из образа ${image}, а просят ${IMAGE}`)
  }
  if (exists(PG)) {
    const label = docker(['inspect', '--format', `{{index .Config.Labels "${SCHEMA_LABEL}"}}`, PG])
    const want = schemaFingerprint()
    if (!label || label === '<no value>') {
      out.push('база поднята без отпечатка схемы (прежней версией скрипта) — неизвестно, какой схемой')
    } else if (label !== want) {
      out.push(`схема в коде изменилась с подъёма базы (${label} → ${want})`)
    }
  }
  return out
}

/** Ждать окружение, которое поднимает кто-то другой, — не снося его. */
function waitForOther() {
  out(`контейнер ${PG} существует, но окружение ещё не готово — жду, не снося`)
  // ⚠️ `waitFor` БРОСАЕТ при неудаче, а не возвращает признак: проверка возвращённого
  // значения была бы мёртвой веткой. Перехватываем и объясняем по-человечески — здесь
  // «не дождались» значит не «сломано», а «возможно, поднимает кто-то другой».
  try {
    waitFor('окружение', () => ready(), 120)
  } catch {
    throw new Error(
      `окружение на порту ${PG_PORT} не поднялось за 120 с и НЕ снесено: возможно, его поднимает другой прогон. ` +
        'Если оно точно ничьё — `itest-env.ts down`, затем `up`, либо `up --recreate`.',
    )
  }
  out('дождался: окружение поднялось')
  printEnv()
}

function up() {
  // ⚠️ ЖИВОЕ ОКРУЖЕНИЕ НЕ СНОСИМ. Раньше `up` безусловно начинался с `docker rm -f`, и
  // второй запуск — в соседней вкладке, по ошибке, из привычки — убивал базу ИДУЩЕГО
  // прогона. Со стороны это выглядело как `ECONNREFUSED` на ровном месте, и соседняя
  // сессия 22.09.2026 дважды искала дефект в своём коде, прежде чем посмотреть на
  // контейнеры.
  //
  // От столкновения РАЗНЫХ сессий защита уже была: имена выводятся из порта. А внутри
  // одного порта защиты не было вовсе — этот случай и закрывается.
  //
  // Пересоздать нарочно: `itest-env.ts down` и затем `up`, либо `up --recreate`.
  const forced = process.argv.includes('--recreate')
  if (!forced) {
    const bad = mismatches()
    if (bad.length) {
      throw new Error(
        `окружение на порту ${PG_PORT} поднято не таким, как просят, и НЕ тронуто:\n  · ${bad.join('\n  · ')}\n` +
          'Пересоздать нарочно: `itest-env.ts up --recreate` (или `down`, затем `up`).',
      )
    }
    if (ready()) {
      out(`окружение на порту ${PG_PORT} уже поднято целиком (база, схема, ядро) — оставляю как есть`)
      out('пересоздать нарочно: npx tsx scripts/itest-env.ts down && npx tsx scripts/itest-env.ts up')
      printEnv()
      return
    }
    // ⚠️ НЕ ОТВЕЧАЕТ — ещё не значит «можно сносить». Если база СУЩЕСТВУЕТ, но проба
    // молчит, её может поднимать соседний `up`: второй снёс бы базу, которую первый как
    // раз поднимает — ровно тот случай, ради которого вся эта ветка и написана.
    if (exists(PG)) return waitForOther()
    // Ядро без базы — обломок прежнего подъёма. Сносить его на обычном пути нельзя по
    // той же причине, что и базу: не отличить обломок от чужого старта на полпути.
    if (exists(CORE)) {
      throw new Error(`контейнер ${CORE} есть, а базы ${PG} нет — обломок прежнего подъёма. \`itest-env.ts up --recreate\``)
    }
  }

  docker(['network', 'create', NET])
  // ⚠️ СНОС — ТОЛЬКО ПО ЯВНОЙ ПРОСЬБЕ. Прежде здесь стоял безусловный `rm -f`, и между
  // проверкой «контейнера нет» выше и этой строкой соседний `up` успевал создать базу —
  // второй сносил её (находка авто-ревью: проверка и снос не атомарны). Атомарность даёт
  // сам docker: `run --name` отказывает, если имя занято, и проигравший гонку уходит
  // ждать победителя, а не сносит его.
  if (forced) docker(['rm', '-f', PG, CORE])

  out('Postgres…')
  const pgRun = spawnSync(
    'docker',
    ['run', '-d', '--name', PG, '--network', NET, '-p', `${PG_PORT}:5432`,
     '--label', `${SCHEMA_LABEL}=${schemaFingerprint()}`,
     '-e', 'POSTGRES_USER=ci', '-e', 'POSTGRES_PASSWORD=ci', '-e', 'POSTGRES_DB=ci',
     'pgvector/pgvector:pg16'],
    { encoding: 'utf8' },
  )
  if (pgRun.status !== 0) {
    // Проиграли гонку за имя — ждём победителя. Признак — сам отказ docker, а не
    // повторный `inspect`: имя резервируется раньше, чем контейнер виден инспекции, и
    // проверка «существует ли» в этот миг отвечает «нет» (поймано живой гонкой двух `up`).
    if (!forced && (/Conflict/.test(pgRun.stderr) || exists(PG))) return waitForOther()
    throw new Error(`docker run ${PG}\n${pgRun.stderr}`)
  }
  // ⚠️ ЖДЁМ ДВА РАЗА ПОДРЯД, И НЕ pg_isready. Официальный образ поднимает ВРЕМЕННЫЙ
  // сервер, чтобы создать базу и пользователя, а потом гасит его и стартует настоящий.
  // В это окно pg_isready отвечает «готов», db:init начинает катить схему и падает на
  // «Connection terminated unexpectedly» — сегодня дважды. Поэтому проверяем НАСТОЯЩИМ
  // запросом и требуем двух успехов подряд с паузой: временный сервер между ними
  // успевает исчезнуть, а настоящий — нет.
  const query = () => spawnSync('docker', ['exec', PG, 'psql', '-U', 'ci', '-d', 'ci', '-c', 'select 1']).status === 0
  let steady = 0
  waitFor('Postgres', () => {
    steady = query() ? steady + 1 : 0
    return steady >= 2
  })

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
  // Имя контейнера базы нужно тестам, которые проверяют поведение при МЁРТВОЙ
  // базе (readiness): они гасят её и поднимают обратно. Без переменной такой
  // тест молча пропускается — самая важная его половина не гоняется вовсе, а
  // прогон при этом зелёный.
  out(`  ITEST_PG_CONTAINER=${PG} \\`)
  // Имя контейнера ЯДРА — тестам, которые портят само репо (посторонний тег,
  // снесённая ветка main) и смотрят, что скажет запись. По той же причине, что и
  // строкой выше: без переменной проба пропускается, а прогон выглядит зелёным.
  out(`  ITEST_CORE_CONTAINER=${CORE} \\`)
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
