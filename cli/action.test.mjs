// GitHub Action «тег → версия и релиз»: настоящий `node action.mjs` (и настоящий `sf` под ним)
// против поддельного MCP-сервера. Подменено только внешнее — сервер и окружение раннера.
import { test, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const TOKEN = 'sf_action_token'
const calls = []
// Уже выпущенные теги: второй страницей, чтобы проверка шла по всем страницам.
let released = []
let server
let base

const reply = (name, args) => {
  if (name === 'list_releases') {
    const page = args.page ?? 1
    const rows = page === 1 ? [{ tag: 'v0.0.1', version: 1 }] : released
    return { ref: args.list, url: `${base}/${args.list}/releases`, releases: rows, ...(page === 1 ? { nextPage: 2 } : {}) }
  }
  if (name === 'get_list') return { version: 7 }
  if (name === 'publish_skill') return { ref: args.list, version: 8 }
  if (name === 'create_release') return { tag: args.tag, version: args.version, url: `${base}/${args.list}/releases`, note: 'n' }
  return { echo: args }
}

before(async () => {
  server = createServer((req, res) => {
    let body = ''
    req.on('data', (c) => (body += c))
    req.on('end', () => {
      if (req.headers.authorization !== `Bearer ${TOKEN}`) return res.writeHead(401).end()
      const rpc = JSON.parse(body)
      if (rpc.method === 'tools/call') calls.push(rpc.params)
      const result =
        rpc.method === 'initialize'
          ? { protocolVersion: '2025-03-26' }
          : { content: [{ type: 'text', text: JSON.stringify(reply(rpc.params.name, rpc.params.arguments)) }] }
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ jsonrpc: '2.0', id: rpc.id, result }))
    })
  })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${server.address().port}`
})
after(() => server.close())
beforeEach(() => {
  calls.length = 0
  released = []
})

function run(env) {
  const dir = mkdtempSync(join(tmpdir(), 'sf-action-'))
  writeFileSync(join(dir, 'SKILL.md'), '---\nname: kit\ndescription: d\n---\n# Kit\n\n1. Do')
  const out = join(dir, 'out.txt')
  writeFileSync(out, '')
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [new URL('./action.mjs', import.meta.url).pathname], {
      cwd: dir,
      env: {
        PATH: process.env.PATH,
        HOME: dir,
        GITHUB_OUTPUT: out,
        'INPUT_LIST': 'miki/kit',
        'INPUT_TOKEN': TOKEN,
        'INPUT_URL': base,
        'INPUT_PATH': '.',
        ...env,
      },
    })
    let log = ''
    p.stdout.on('data', (d) => (log += d))
    p.stderr.on('data', (d) => (log += d))
    p.on('close', (code) => resolve({ code, log, outputs: Object.fromEntries(readFileSync(out, 'utf8').trim().split('\n').filter(Boolean).map((l) => l.split('='))) }))
  })
}

const names = () => calls.map((c) => c.name)

test('запушенный тег → папка одной версией и релиз ИМЕННО этой версии', async () => {
  const r = await run({ GITHUB_REF_TYPE: 'tag', GITHUB_REF_NAME: 'v0.7.0' })
  assert.equal(r.code, 0, r.log)
  assert.deepEqual(names(), ['list_releases', 'list_releases', 'get_list', 'publish_skill', 'create_release'])
  const rel = calls.find((c) => c.name === 'create_release').arguments
  assert.deepEqual({ tag: rel.tag, version: rel.version, confirm: rel.confirm, generateNotes: rel.generateNotes }, { tag: 'v0.7.0', version: 8, confirm: true, generateNotes: true })
  // Папка — правда: набор файлов заменяется, а не дополняется.
  assert.equal(calls.find((c) => c.name === 'publish_skill').arguments.replaceFiles, true)
  assert.equal(r.outputs.version, '8')
  assert.equal(r.outputs['release-url'], `${base}/miki/kit/releases`)
})

test('перезапуск того же тега — ничего не публикуется, выход успехом с его версией', async () => {
  released = [{ tag: 'v0.7.0', version: 5 }]
  const r = await run({ GITHUB_REF_TYPE: 'tag', GITHUB_REF_NAME: 'v0.7.0' })
  assert.equal(r.code, 0, r.log)
  assert.ok(!names().includes('publish_skill') && !names().includes('create_release'), names().join())
  assert.equal(r.outputs.version, '5')
  assert.match(r.log, /already released as v5/)
})

test('без тега (push в ветку) — только версия, релиза нет', async () => {
  const r = await run({ GITHUB_REF_TYPE: 'branch', GITHUB_REF_NAME: 'main' })
  assert.equal(r.code, 0, r.log)
  assert.deepEqual(names(), ['get_list', 'publish_skill'])
  assert.equal(r.outputs.version, '8')
})

test('тег задан входом — он главнее запушенного; prerelease доезжает', async () => {
  const r = await run({ GITHUB_REF_TYPE: 'branch', INPUT_TAG: 'v1.0.0-rc.1', INPUT_PRERELEASE: 'true' })
  assert.equal(r.code, 0, r.log)
  const rel = calls.find((c) => c.name === 'create_release').arguments
  assert.equal(rel.tag, 'v1.0.0-rc.1')
  assert.equal(rel.prerelease, true)
})

test('кривой list и чужой токен — ошибка шага, а не молчаливый успех; токен не печатается', async () => {
  const bad = await run({ INPUT_LIST: 'kit' })
  assert.equal(bad.code, 1)
  assert.match(bad.log, /::error::input "list" must be owner\/slug/)
  const denied = await run({ INPUT_TOKEN: 'sf_wrong', GITHUB_REF_TYPE: 'tag', GITHUB_REF_NAME: 'v1' })
  assert.notEqual(denied.code, 0)
  assert.match(denied.log, /::error::/)
  assert.ok(!denied.log.includes('sf_wrong') && !denied.log.includes(TOKEN))
})
