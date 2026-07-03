import 'server-only'
import { spawn } from 'node:child_process'
import { gunzipSync } from 'node:zlib'

// Минимальная реализация git smart-HTTP (read-only: upload-pack).
// Работает поверх материализованного репо (см. bundle.ts materializeRepoForList).

function pktLine(s: string): Buffer {
  const len = Buffer.byteLength(s) + 4
  return Buffer.from(len.toString(16).padStart(4, '0') + s)
}

function runGit(args: string[], input: Buffer | undefined, gitProtocol: string | undefined): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const env = { ...process.env }
    if (gitProtocol) env.GIT_PROTOCOL = gitProtocol
    const p = spawn('git', args, { env })
    const out: Buffer[] = []
    const err: Buffer[] = []
    p.stdout.on('data', (d: Buffer) => out.push(d))
    p.stderr.on('data', (d: Buffer) => err.push(d))
    p.on('error', reject)
    p.on('close', (code) => {
      if (code === 0) resolve(Buffer.concat(out))
      else reject(new Error(`git ${args.join(' ')} exited ${code}: ${Buffer.concat(err).toString()}`))
    })
    if (input) p.stdin.write(input)
    p.stdin.end()
  })
}

/** GET /info/refs?service=git-upload-pack — реклама ссылок (smart-HTTP). */
export async function uploadPackAdvertise(repoDir: string, gitProtocol?: string): Promise<Buffer> {
  const refs = await runGit(['upload-pack', '--stateless-rpc', '--advertise-refs', repoDir], undefined, gitProtocol)
  // v2 (GIT_PROTOCOL=version=2) не добавляет "# service" в тело — но git-клиент это принимает.
  return Buffer.concat([pktLine('# service=git-upload-pack\n'), Buffer.from('0000'), refs])
}

/** POST /git-upload-pack — согласование + packfile. */
export async function uploadPackRpc(repoDir: string, body: Buffer, gitProtocol?: string): Promise<Buffer> {
  return runGit(['upload-pack', '--stateless-rpc', repoDir], body, gitProtocol)
}

/** GET /info/refs?service=git-receive-pack — реклама для push. */
export async function receivePackAdvertise(repoDir: string, gitProtocol?: string): Promise<Buffer> {
  const refs = await runGit(['receive-pack', '--stateless-rpc', '--advertise-refs', repoDir], undefined, gitProtocol)
  return Buffer.concat([pktLine('# service=git-receive-pack\n'), Buffer.from('0000'), refs])
}

/** POST /git-receive-pack — приём пака (обновляет ref'ы в bare-репо). */
export async function receivePackRpc(repoDir: string, body: Buffer, gitProtocol?: string): Promise<Buffer> {
  return runGit(['receive-pack', '--stateless-rpc', repoDir], body, gitProtocol)
}

/** Распаковать тело, если Content-Encoding: gzip. */
export function maybeGunzip(body: Buffer, contentEncoding: string | null): Buffer {
  return contentEncoding && contentEncoding.includes('gzip') ? gunzipSync(body) : body
}
