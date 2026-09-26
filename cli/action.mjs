// GitHub Action «тег → версия и релиз» поверх того же `sf`, что у людей: один контракт
// (MCP-инструменты), одни отказы. Вход — INPUT_*, выход — $GITHUB_OUTPUT (как у любого
// JavaScript-действия), без зависимостей и без bash: значения входов не попадают в шелл.
import { spawnSync } from 'node:child_process'
import { appendFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const SF = fileURLToPath(new URL('./sf.mjs', import.meta.url))
const input = (name, env = process.env) => (env[`INPUT_${name.toUpperCase()}`] ?? '').trim()

/** Тег релиза: заданный явно, иначе запушенный (`on: push: tags`), иначе релиза нет. */
export function releaseTag(env = process.env) {
  return input('tag', env) || (env.GITHUB_REF_TYPE === 'tag' ? env.GITHUB_REF_NAME ?? '' : '')
}

function sf(args, env) {
  const r = spawnSync(process.execPath, [SF, ...args], { env, encoding: 'utf8' })
  if (r.status !== 0) {
    // sf уже сказал причину человеческим текстом — отдаём её в журнал как ошибку шага.
    process.stdout.write(`::error::${(r.stderr || r.stdout).trim().replace(/\r?\n/g, '%0A')}\n`)
    process.exit(r.status ?? 1)
  }
  return JSON.parse(r.stdout)
}

function output(env, pairs) {
  if (!env.GITHUB_OUTPUT) return
  appendFileSync(env.GITHUB_OUTPUT, Object.entries(pairs).map(([k, v]) => `${k}=${v}\n`).join(''))
}

function summary(env, line) {
  if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, `${line}\n`)
  console.log(line)
}

/** Релиз с этим тегом, если он уже есть: страницами, пока не кончатся. */
function findRelease(list, tag, child) {
  for (let page = 1; page; ) {
    const r = sf(['api', 'list_releases', JSON.stringify({ list, limit: 50, page })], child)
    const hit = (r.releases ?? []).find((x) => x.tag === tag)
    if (hit) return { version: hit.version, url: r.url ?? '' }
    page = r.nextPage ?? 0
  }
  return null
}

export function main(env = process.env) {
  const list = input('list', env)
  if (!/^[^/\s]+\/[^/\s]+$/.test(list)) {
    console.log(`::error::input "list" must be owner/slug, got "${list}"`)
    process.exit(1)
  }
  // Токен — только окружением дочернего процесса, как SETFORK_TOKEN у людей в CI.
  const child = { ...env, SETFORK_TOKEN: input('token', env), SETFORK_URL: input('url', env) || env.SETFORK_URL || '' }
  const tag = releaseTag(env)

  // ПОВТОРНЫЙ ЗАПУСК того же тега (перезапуск джобы) — не новая версия: publish_skill пишет
  // версию и без изменений, а второй релиз с тем же тегом сервер отвергнет. Тег уже выпущен —
  // говорим, на какую версию он указывает, и выходим успехом.
  if (tag) {
    const done = findRelease(list, tag, child)
    if (done) {
      output(env, { version: done.version, 'release-url': done.url })
      summary(env, `${list}: ${tag} is already released as v${done.version} — nothing published`)
      return
    }
  }

  const published = sf(['skill', 'publish', input('path', env) || '.', list, '--json'], child)
  output(env, { version: published.version })
  if (!tag) {
    summary(env, `${list}: published v${published.version} (no tag — no release)`)
    return
  }
  const rel = sf(
    ['release', 'create', list, tag, '--version', String(published.version), '--generate-notes', '--yes', '--json', ...(input('prerelease', env) === 'true' ? ['--prerelease'] : [])],
    child,
  )
  output(env, { 'release-url': rel.url ?? '' })
  summary(env, `${list}: ${tag} → v${published.version} ${rel.url ?? ''}`.trim())
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main()
