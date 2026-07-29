/**
 * Линза 02, F3: мост «настоящий git-клиент → gRPC Rust-ядра».
 *
 * Повторяет ровно то, что делает роут `[handle]/[slug]/[...git]`, НО без слоя
 * авторизации — потому что проверяется именно он: роут не смотрит на
 * архив/заморозку, а ядро о них вообще не знает. Если после `git push` в
 * ЗАМОРОЖЕННЫЙ список в БД появилась новая версия — заморозка не держит.
 *
 * Запуск: DATABASE_URL=... SETFORK_CORE_URL=1 SETFORK_CORE_ADDR=127.0.0.1:50051 \
 *         SETFORK_CORE_TOKEN=... npx tsx scripts/lens02-git-bridge.ts <owner> <slug> <port>
 */
import { createServer } from 'node:http'
import { createRequire } from 'node:module'

// core.remote.ts помечен 'server-only' (в vitest это алиас на пустышку). Здесь
// подменяем резолв тем же способом, чтобы гонять НАСТОЯЩИЙ адаптер приложения,
// а не его копию.
const require_ = createRequire(import.meta.url)
const Mod = require_('module') as { _resolveFilename: (r: string, ...a: unknown[]) => string }
const origResolve = Mod._resolveFilename
Mod._resolveFilename = function (request: string, ...args: unknown[]) {
  if (request === 'server-only' || request === 'client-only') return require_.resolve('./empty-shim.cjs')
  return origResolve.call(this, request, ...args)
}

type GitCorePort = typeof import('../src/features/git/core.remote')['gitCoreRemote']
let gitCoreRemote: GitCorePort

const [owner, slug, portRaw] = process.argv.slice(2)
const port = Number(portRaw || 3099)

async function readBody(req: import('node:http').IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = []
  for await (const c of req) chunks.push(c as Buffer)
  return Buffer.concat(chunks)
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://127.0.0.1:${port}`)
  const gitProtocol = (req.headers['git-protocol'] as string) || undefined
  const repo = { owner, slug }
  try {
    if (url.pathname.endsWith('/info/refs')) {
      const service = url.searchParams.get('service')
      const data =
        service === 'git-receive-pack'
          ? await gitCoreRemote.infoRefsReceivePack(repo, gitProtocol)
          : await gitCoreRemote.infoRefsUploadPack(repo, gitProtocol)
      res.writeHead(200, { 'Content-Type': `application/x-${service}-advertisement`, 'Cache-Control': 'no-cache' })
      res.end(Buffer.from(data!))
      return
    }
    if (url.pathname.endsWith('/git-receive-pack')) {
      const out = await gitCoreRemote.receivePack(repo, await readBody(req), gitProtocol)
      console.log(`[мост] receivePack → newVersion=${JSON.stringify(out?.newVersion)}`)
      res.writeHead(200, { 'Content-Type': 'application/x-git-receive-pack-result', 'Cache-Control': 'no-cache' })
      res.end(Buffer.from(out!.data))
      return
    }
    if (url.pathname.endsWith('/git-upload-pack')) {
      const out = await gitCoreRemote.uploadPack(repo, await readBody(req), gitProtocol)
      res.writeHead(200, { 'Content-Type': 'application/x-git-upload-pack-result', 'Cache-Control': 'no-cache' })
      res.end(Buffer.from(out!))
      return
    }
    res.writeHead(404).end('not found')
  } catch (e) {
    console.error('[мост] ошибка:', (e as Error).message)
    res.writeHead(500).end((e as Error).message)
  }
})

async function main(): Promise<void> {
  ;({ gitCoreRemote } = await import('../src/features/git/core.remote'))
  server.listen(port, '127.0.0.1', () => console.log(`[мост] http://127.0.0.1:${port}/${owner}/${slug}.git → ядро`))
}

void main()
