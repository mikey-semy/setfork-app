#!/usr/bin/env node
// sf — CLI для SetFork в духе `gh`: списки, скиллы, релизы из терминала.
// Клон и скрипт — git и /raw; всё остальное — те же инструменты MCP, что у агентов:
// один контракт, одни права токена, одни тексты отказов. Без зависимостей.
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { parseArgs } from 'node:util'
import { baseUrl, cloneUrl, pageUrl, parseRef, rawUrl } from './lib.mjs'
import { removeToken, saveToken, tokenFor } from './auth.mjs'
import { mcpClient } from './mcp.mjs'
import { readSkillDir } from './skill.mjs'

const [, , cmd, ...rest] = process.argv

const HELP = `sf — SetFork CLI

Lists:
  sf clone   <owner/slug> [dir]          git clone the list repository
  sf raw     <owner/slug>                print the runnable script to stdout
  sf url     <owner/slug>                print the list page URL
  sf open    <owner/slug>                open the list in your browser
  sf list view   <owner/slug>            title, version, blocks and skill files
  sf list rename <owner/slug> <new-slug> change the address; the old one keeps redirecting

Agent Skills:
  sf skill publish <dir> [owner/slug]    publish a skill folder (SKILL.md + scripts/, references/,
                                         assets/) as ONE version; without owner/slug creates a
                                         new draft. The folder is the truth: files missing from it
                                         are removed from the list.  [--base N]
  sf skill install <owner/slug>          npx skills add <site>/<owner>/<slug>/skill.tar.gz

Releases:
  sf release list   <owner/slug>
  sf release create <owner/slug> <tag>   [--title T] [--notes-file F|-] [--version N]
                                         [--prerelease] [--generate-notes] [--yes]
                                         without --yes only reports what would be published

Account and anything else:
  sf auth login [--with-token]           save an API token (write scope for changes)
  sf auth status | logout
  sf api <tool> ['{json}' | @file | -]   call any MCP tool directly (like gh api)
  sf version | help

Env:
  SETFORK_URL    instance base (default ${baseUrl()})
  SETFORK_TOKEN  token to use instead of the saved one (CI)`

function die(msg, code = 1) {
  console.error(msg)
  process.exit(code)
}

const host = () => new URL(baseUrl()).host

function client() {
  const t = tokenFor(host())
  if (!t) die(`not logged in to ${host()} — run: sf auth login (or set SETFORK_TOKEN)`)
  return mcpClient({ base: baseUrl(), token: t.token })
}

/** Вызов инструмента: отказ сервера — в stderr как есть и выход 1. */
async function call(name, args) {
  const r = await client().call(name, args)
  if (!r.ok) die(r.text)
  return r.data ?? r.text
}

function openInBrowser(url) {
  const [bin, pre] =
    process.platform === 'darwin' ? ['open', []] : process.platform === 'win32' ? ['cmd', ['/c', 'start', '']] : ['xdg-open', []]
  spawnSync(bin, [...pre, url], { stdio: 'ignore' })
}

async function readStdin() {
  const chunks = []
  for await (const c of process.stdin) chunks.push(c)
  return Buffer.concat(chunks).toString('utf8')
}

/** Скрытый ввод токена с терминала: символы не печатаются, как у `gh auth login`. */
async function promptHidden(question) {
  process.stdout.write(question)
  const stdin = process.stdin
  stdin.setRawMode(true)
  stdin.resume()
  let value = ''
  return new Promise((resolve) => {
    const onData = (buf) => {
      for (const ch of buf.toString('utf8')) {
        if (ch === '\r' || ch === '\n') {
          stdin.setRawMode(false)
          stdin.pause()
          stdin.off('data', onData)
          process.stdout.write('\n')
          return resolve(value.trim())
        }
        if (ch === '\u0003') process.exit(130)
        if (ch === '\u007f') value = value.slice(0, -1)
        else value += ch
      }
    }
    stdin.on('data', onData)
  })
}

const print = (x) => console.log(typeof x === 'string' ? x : JSON.stringify(x, null, 2))
const refOf = (s) => {
  const { owner, slug } = parseRef(s)
  return { owner, slug, list: `${owner}/${slug}` }
}

async function auth(sub, args) {
  switch (sub) {
    case 'login': {
      const { values } = parseArgs({ args, options: { 'with-token': { type: 'boolean' } } })
      const token =
        values['with-token'] || !process.stdin.isTTY
          ? (await readStdin()).trim()
          : await promptHidden(`Paste a SetFork API token for ${host()} (Settings → API tokens): `)
      if (!token) die('no token given')
      // Проверяем токен настоящим вызовом ДО сохранения: сохранённый неверный токен
      // проявился бы потом, на первой записи, непонятной ошибкой.
      const r = await mcpClient({ base: baseUrl(), token }).call('my_catalogs', {})
      if (!r.ok) die(`the token does not work: ${r.text}`)
      const file = saveToken(host(), token)
      console.log(`✓ Logged in to ${host()} — token saved to ${file} (mode 600)`)
      break
    }
    case 'status': {
      const t = tokenFor(host())
      if (!t) die(`not logged in to ${host()}`)
      const r = await mcpClient({ base: baseUrl(), token: t.token })
        .call('my_catalogs', {})
        .catch((e) => ({ ok: false, text: e.message }))
      console.log(`${host()}: token from ${t.source} — ${r.ok ? 'works' : `does NOT work: ${r.text}`}`)
      if (!r.ok) process.exit(1)
      break
    }
    case 'logout':
      console.log(removeToken(host()) ? `✓ Logged out of ${host()}` : `not logged in to ${host()}`)
      break
    default:
      die('usage: sf auth login|status|logout')
  }
}

async function list(sub, args) {
  switch (sub) {
    case 'view': {
      if (!args[0]) die('usage: sf list view <owner/slug>')
      const { owner, slug } = refOf(args[0])
      const l = await call('get_list', { handle: owner, slug })
      console.log(`${l.ref} — ${l.title}  (v${l.version})`)
      if (l.desc) console.log(l.desc)
      console.log(`${(l.steps ?? []).length} blocks · ${pageUrl(l.ref)}`)
      for (const f of l.files ?? []) console.log(`  ${f.executable ? '755' : '644'}  ${f.path}  ${f.bytes} B`)
      if (l.pendingEdits) console.log(`pending edits on v${l.pendingEdits.baseVersion}: ${l.pendingEdits.blocks} blocks (publish_draft)`)
      break
    }
    case 'rename': {
      if (!args[0] || !args[1]) die('usage: sf list rename <owner/slug> <new-slug>')
      const r = await call('rename_list', { list: refOf(args[0]).list, slug: args[1] })
      console.log(`✓ ${r.previous} → ${r.ref}\n${r.note}`)
      break
    }
    default:
      die('usage: sf list view|rename …')
  }
}

async function skill(sub, args) {
  switch (sub) {
    case 'publish': {
      const { values, positionals } = parseArgs({ args, allowPositionals: true, options: { base: { type: 'string' } } })
      const [dir, ref] = positionals
      if (!dir) die('usage: sf skill publish <dir> [owner/slug] [--base N]')
      const { skillMd, files, skipped } = readSkillDir(dir)
      for (const s of skipped) console.error(`skipped: ${s}`)
      // Папка — правда: файлы, которых в ней нет, из списка уходят (replaceFiles).
      const input = { skillMd, files, replaceFiles: true }
      if (ref) {
        const { owner, slug, list: l } = refOf(ref)
        input.list = l
        // База — версия, что сейчас: чужую правку, легшую между чтением и записью, сервер
        // затереть всё равно не даст.
        input.baseVersion = values.base ? Number(values.base) : (await call('get_list', { handle: owner, slug })).version
      }
      const r = await call('publish_skill', input)
      console.log(`✓ ${r.ref} — version ${r.version}`)
      if (r.files) {
        const f = r.files
        if (f.unchanged) console.log('  files: unchanged')
        else
          console.log(
            `  files: +${(f.added ?? []).length} ~${(f.changed ?? []).length} -${(f.removed ?? []).length}${f.total != null ? ` (${f.total} total)` : ''}`,
          )
      }
      for (const n of r.parseNotes ?? []) console.log(`  note: ${n}`)
      if (r.note) console.log(r.note)
      break
    }
    case 'install': {
      if (!args[0]) die('usage: sf skill install <owner/slug>')
      const { list: l } = refOf(args[0])
      const url = `${baseUrl()}/${l}/skill.tar.gz`
      const r = spawnSync('npx', ['-y', 'skills', 'add', url, ...args.slice(1)], { stdio: 'inherit' })
      process.exit(r.status ?? 0)
      break
    }
    default:
      die('usage: sf skill publish|install …')
  }
}

async function release(sub, args) {
  switch (sub) {
    case 'list': {
      if (!args[0]) die('usage: sf release list <owner/slug>')
      const r = await call('list_releases', { list: refOf(args[0]).list, limit: 50 })
      if (!r.releases.length) console.log('no releases')
      for (const x of r.releases) console.log(`${x.tag}\tv${x.version}\t${x.latest ? 'Latest' : x.prerelease ? 'Pre-release' : ''}\t${x.title ?? ''}`)
      break
    }
    case 'create': {
      const { values, positionals } = parseArgs({
        args,
        allowPositionals: true,
        options: {
          title: { type: 'string' },
          'notes-file': { type: 'string' },
          version: { type: 'string' },
          prerelease: { type: 'boolean' },
          'generate-notes': { type: 'boolean' },
          yes: { type: 'boolean', short: 'y' },
        },
      })
      const [ref, tag] = positionals
      if (!ref || !tag) die('usage: sf release create <owner/slug> <tag> [--title T] [--notes-file F|-] [--yes]')
      const nf = values['notes-file']
      const notes = nf ? (nf === '-' ? await readStdin() : readFileSync(nf, 'utf8')) : undefined
      const r = await call('create_release', {
        list: refOf(ref).list,
        tag,
        title: values.title,
        notes,
        version: values.version ? Number(values.version) : undefined,
        prerelease: values.prerelease,
        generateNotes: values['generate-notes'],
        confirm: values.yes === true,
      })
      if (r.wouldPublish) {
        print(r)
        console.error('\nnothing was published — repeat with --yes to publish')
      } else console.log(`✓ ${r.tag} → v${r.version}  ${r.url}\n${r.note}`)
      break
    }
    default:
      die('usage: sf release list|create …')
  }
}

async function api(args) {
  const [tool, raw] = args
  if (!tool) die("usage: sf api <tool> ['{json}' | @file | -]")
  const text = raw === undefined ? '{}' : raw === '-' ? await readStdin() : raw.startsWith('@') ? readFileSync(raw.slice(1), 'utf8') : raw
  let params
  try {
    params = JSON.parse(text)
  } catch {
    die('arguments must be a JSON object')
  }
  print(await call(tool, params))
}

try {
  switch (cmd) {
    case 'clone': {
      if (!rest[0]) die('usage: sf clone <owner/slug> [dir]')
      const r = spawnSync('git', ['clone', cloneUrl(rest[0]), ...(rest[1] ? [rest[1]] : [])], { stdio: 'inherit' })
      process.exit(r.status ?? 0)
      break
    }
    case 'raw': {
      if (!rest[0]) die('usage: sf raw <owner/slug>')
      const res = await fetch(rawUrl(rest[0]))
      if (!res.ok) die(`fetch failed: ${res.status} ${res.statusText}`)
      process.stdout.write(await res.text())
      break
    }
    case 'url':
      if (!rest[0]) die('usage: sf url <owner/slug>')
      console.log(pageUrl(rest[0]))
      break
    case 'open': {
      if (!rest[0]) die('usage: sf open <owner/slug>')
      const u = pageUrl(rest[0])
      openInBrowser(u)
      console.log(u)
      break
    }
    case 'auth':
      await auth(rest[0], rest.slice(1))
      break
    case 'list':
      await list(rest[0], rest.slice(1))
      break
    case 'skill':
      await skill(rest[0], rest.slice(1))
      break
    case 'release':
      await release(rest[0], rest.slice(1))
      break
    case 'api':
      await api(rest)
      break
    case 'version':
    case '--version':
    case '-v': {
      const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url)))
      console.log(pkg.version)
      break
    }
    case undefined:
    case 'help':
    case '--help':
    case '-h':
      console.log(HELP)
      break
    default:
      die(`unknown command "${cmd}"\n\n${HELP}`)
  }
} catch (e) {
  die(e instanceof Error ? e.message : String(e))
}
