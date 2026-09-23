import { Code, ConnectError } from '@connectrpc/connect'
import { describe, expect, it, vi } from 'vitest'

/**
 * АВТОРСКИЕ ФАЙЛЫ ВЕРСИИ: «ЯДРО НЕ УМЕЕТ» ≠ «ЯДРО НЕ ОТВЕТИЛО».
 *
 * Фронт и ядро выкатываются порознь, и новый фронт рядом со старым ядром получает на
 * `GetAuthoredFiles` UNIMPLEMENTED. Это ответ по существу — «не умею», — и экспорт скилла
 * обязан собраться из блоков, как до ADR-0028. А вот обрыв связи — не ответ: выдать его
 * за «файлов нет» значит молча отдать архив без скриптов автора.
 */
const h = vi.hoisted(() => ({ reply: null as unknown }))

vi.mock('@/shared/core-transport', () => ({ coreTransport: () => ({}), mirrorPushTimeoutMs: () => 1000 }))
vi.mock('@connectrpc/connect', async (orig) => ({
  ...(await orig<typeof import('@connectrpc/connect')>()),
  createClient: () => ({
    getAuthoredFiles: async () => {
      if (h.reply instanceof Error) throw h.reply
      return h.reply
    },
  }),
}))

const { gitCoreRemote } = await import('@/features/git/core.remote')
const { GitTransportError } = await import('@/core')

const read = () => gitCoreRemote.authoredFiles({ owner: 'o', slug: 's' }, 3)

describe('авторские файлы версии из ядра', () => {
  it('старое ядро (UNIMPLEMENTED) — null, экспорт соберётся из блоков', async () => {
    h.reply = new ConnectError('unknown method', Code.Unimplemented)
    await expect(read()).resolves.toBeNull()
  })

  it('⚠️ обрыв связи — отказ, а не «файлов нет»', async () => {
    h.reply = new ConnectError('connection reset', Code.Unavailable)
    await expect(read(), 'сбой выдан за пустой ответ — архив молча без скриптов').rejects.toBeInstanceOf(GitTransportError)
  })

  it('версии нет (found=false) — null', async () => {
    h.reply = { found: false, files: [] }
    await expect(read()).resolves.toBeNull()
  })

  it('файлы доезжают как есть: путь, байты, исполняемость', async () => {
    const content = new TextEncoder().encode('echo hi\n')
    h.reply = { found: true, files: [{ path: 'scripts/run.sh', content, executable: true }] }
    await expect(read()).resolves.toEqual([{ path: 'scripts/run.sh', content, executable: true }])
  })
})
