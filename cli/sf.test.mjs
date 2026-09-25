// sf целиком: настоящий процесс против поддельного MCP-сервера (node:http). Подменено
// только внешнее — сервер; разбор аргументов, хранение токена, сборка папки скилла и
// вызовы — настоящие.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseRpcBody, toolResult } from './mcp.mjs'

const GOOD = 'sf_good_token_value'
// Сервер пускает, но инструмент отказывает (отозванный скоуп, заблокированный аккаунт).
const LIMITED = 'sf_limited_token'
const calls = []
let server
let base
let cfg

const answer = (name, args, token) => {
  if (name === 'my_catalogs' && token === LIMITED) return { content: [{ type: 'text', text: 'account is blocked' }], isError: true }
  if (name === 'my_catalogs') return { content: [{ type: 'text', text: '[]' }] }
  if (name === 'get_list') return { content: [{ type: 'text', text: JSON.stringify({ ref: 'miki/kit', title: 'Kit', version: 7, steps: [{}], files: [{ path: 'scripts/run.sh', executable: true, bytes: 3 }] }) }] }
  if (name === 'publish_skill') return { content: [{ type: 'text', text: JSON.stringify({ ref: args.list ?? 'miki/new', version: 8, files: { added: [], changed: ['scripts/run.sh'], removed: ['assets/old.txt'], total: 2 } }) }] }
  if (name === 'import_skill')
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({ ref: 'miki/pdf', privateOnly: true, license: { id: null, open: false }, sourceUrl: 'https://github.com/a/b/tree/abc/pdf', skipped: [{ path: 'assets/x.png', why: 'binary' }], note: 'private' }),
        },
      ],
    }
  if (name === 'create_release')
    return { content: [{ type: 'text', text: JSON.stringify(args.confirm ? { tag: args.tag, version: 7, url: 'u', note: 'n' } : { wouldPublish: { tag: args.tag } }) }] }
  if (name === 'boom') return { content: [{ type: 'text', text: 'refused: because' }], isError: true }
  return { content: [{ type: 'text', text: JSON.stringify({ echo: args }) }] }
}

before(async () => {
  server = createServer((req, res) => {
    let body = ''
    req.on('data', (c) => (body += c))
    req.on('end', () => {
      const token = (req.headers.authorization ?? '').replace('Bearer ', '')
      if (token !== GOOD && token !== LIMITED) {
        res.writeHead(401).end()
        return
      }
      const rpc = JSON.parse(body)
      if (rpc.method === 'tools/call') calls.push(rpc.params)
      const result = rpc.method === 'initialize' ? { protocolVersion: '2025-03-26' } : answer(rpc.params.name, rpc.params.arguments, token)
      // Отвечаем потоком SSE — так отвечает настоящий сервер.
      res.writeHead(200, { 'Content-Type': 'text/event-stream' }).end(`event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', id: rpc.id, result })}\n\n`)
    })
  })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${server.address().port}`
  cfg = mkdtempSync(join(tmpdir(), 'sf-cfg-'))
})
after(() => server.close())

function sf(args, { input, env = {} } = {}) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [new URL('./sf.mjs', import.meta.url).pathname, ...args], {
      env: { ...process.env, SETFORK_URL: base, XDG_CONFIG_HOME: cfg, SETFORK_TOKEN: '', ...env },
    })
    let out = ''
    let err = ''
    p.stdout.on('data', (d) => (out += d))
    p.stderr.on('data', (d) => (err += d))
    p.on('close', (code) => resolve({ code, out, err }))
    p.stdin.end(input ?? '')
  })
}

test('SSE и JSON-ответы разбираются одинаково', () => {
  const obj = { jsonrpc: '2.0', id: 1, result: { content: [{ type: 'text', text: '{"a":1}' }] } }
  assert.deepEqual(parseRpcBody(JSON.stringify(obj)), obj)
  assert.deepEqual(parseRpcBody(`event: message\ndata: ${JSON.stringify(obj)}\n\n`), obj)
  assert.deepEqual(toolResult(obj), { ok: true, text: '{"a":1}', data: { a: 1 } })
  assert.equal(toolResult({ result: { content: [{ text: 'no' }], isError: true } }).ok, false)
})

test('без входа — внятный отказ, а не сырой 401', async () => {
  const r = await sf(['list', 'view', 'miki/kit'])
  assert.equal(r.code, 1)
  assert.match(r.err, /sf auth login/)
})

test('auth login: неверный токен не сохраняется', async () => {
  const r = await sf(['auth', 'login', '--with-token'], { input: 'sf_wrong' })
  assert.equal(r.code, 1)
  assert.throws(() => readFileSync(join(cfg, 'setfork', 'hosts.json')))
})

test('auth login: сервер пустил, но инструмент отказал — тоже не сохраняется', async () => {
  const r = await sf(['auth', 'login', '--with-token'], { input: LIMITED })
  assert.equal(r.code, 1)
  assert.match(r.err, /the token does not work: account is blocked/)
  assert.throws(() => readFileSync(join(cfg, 'setfork', 'hosts.json')))
})

test('auth login: верный — сохранён с правами 600 и нигде не напечатан', async () => {
  const r = await sf(['auth', 'login', '--with-token'], { input: `${GOOD}\n` })
  assert.equal(r.code, 0, r.err)
  const file = join(cfg, 'setfork', 'hosts.json')
  assert.equal(statSync(file).mode & 0o777, 0o600)
  assert.ok(!r.out.includes(GOOD) && !r.err.includes(GOOD))
  const st = await sf(['auth', 'status'])
  assert.match(st.out, /works/)
  assert.ok(!st.out.includes(GOOD))
})

test('skill publish: папка — правда; база из get_list; режим только у scripts/; лишнее названо', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'sf-skill-'))
  writeFileSync(join(dir, 'SKILL.md'), '---\nname: kit\ndescription: d\n---\n# Kit\n\n1. Do')
  for (const d of ['scripts', 'references', 'assets']) mkdirSync(join(dir, d))
  writeFileSync(join(dir, 'scripts', 'run.sh'), 'echo hi\n')
  chmodSync(join(dir, 'scripts', 'run.sh'), 0o755)
  writeFileSync(join(dir, 'references', 'guide.md'), '# g\n')
  chmodSync(join(dir, 'references', 'guide.md'), 0o755)
  writeFileSync(join(dir, 'assets', 'logo.png'), Buffer.from([0x89, 0, 1]))
  mkdirSync(join(dir, 'assets', 'nested'))
  writeFileSync(join(dir, 'README.md'), 'x')
  calls.length = 0
  const r = await sf(['skill', 'publish', dir, 'miki/kit'])
  assert.equal(r.code, 0, r.err)
  assert.deepEqual(calls.map((c) => c.name), ['get_list', 'publish_skill'])
  const input = calls[1].arguments
  assert.equal(input.list, 'miki/kit')
  assert.equal(input.baseVersion, 7)
  assert.equal(input.replaceFiles, true)
  assert.match(input.skillMd, /^---\nname: kit/)
  // Исполняемый бит — только у scripts/: у references/guide.md (755 на диске) его нет.
  assert.deepEqual(input.files, [
    { path: 'scripts/run.sh', content: 'echo hi\n', executable: true },
    { path: 'references/guide.md', content: '# g\n' },
  ])
  assert.match(r.err, /skipped: assets\/logo\.png \(binary/)
  assert.match(r.err, /skipped: assets\/nested/)
  assert.match(r.err, /skipped: README\.md/)
  assert.match(r.out, /version 8/)
  assert.match(r.out, /\+0 ~1 -1 \(2 total\)/)
})

test('release create без --yes — только отчёт, confirm:false', async () => {
  calls.length = 0
  const r = await sf(['release', 'create', 'miki/kit', 'v1.0.0'])
  assert.equal(r.code, 0, r.err)
  assert.equal(calls[0].arguments.confirm, false)
  assert.match(r.err, /nothing was published/)
  calls.length = 0
  await sf(['release', 'create', 'miki/kit', 'v1.0.0', '--yes', '--title', 'T'])
  assert.deepEqual(calls[0].arguments, { list: 'miki/kit', tag: 'v1.0.0', title: 'T', confirm: true })
})

test('api: любой инструмент; отказ сервера — stderr и выход 1', async () => {
  const ok = await sf(['api', 'echo_tool', '{"x":1}'])
  assert.deepEqual(JSON.parse(ok.out), { echo: { x: 1 } })
  const bad = await sf(['api', 'boom'])
  assert.equal(bad.code, 1)
  assert.match(bad.err, /refused: because/)
})

test('SETFORK_TOKEN главнее сохранённого', async () => {
  const r = await sf(['auth', 'status'], { env: { SETFORK_TOKEN: 'sf_other' } })
  assert.equal(r.code, 1)
  assert.match(r.out, /SETFORK_TOKEN — does NOT work/)
})

test('skill import: адрес уходит в import_skill, приватность и пропуски названы', async () => {
  calls.length = 0
  const r = await sf(['skill', 'import', 'github.com/a/b/tree/main/pdf'])
  assert.equal(r.code, 0, r.err)
  assert.deepEqual(calls.map((c) => c.name), ['import_skill'])
  assert.deepEqual(calls[0].arguments, { url: 'github.com/a/b/tree/main/pdf' })
  assert.match(r.out, /PRIVATE draft, license: none/)
  assert.match(r.out, /skipped: assets\/x\.png — binary/)
})

