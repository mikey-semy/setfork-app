import { describe, expect, it, vi } from 'vitest'

/**
 * СБОЙ СВЯЗИ С ЯДРОМ НЕ ВЫДАЁТСЯ ЗА ОТВЕТ «ВЕТКИ НЕТ».
 *
 * `branchSnapshot` обещает `null` ровно для одного случая — ветки или `list.json` в ней
 * нет. Реализация же гасила ЛЮБУЮ неудачу (`.catch(() => null)`), и обрыв соединения
 * приходил вызывающему тем же значением, что честный ответ. Цена была не косметическая:
 * на этом чтении стоит страж исполняемых команд при слиянии ветки, и пустое содержимое
 * он читал как «команд нет», то есть как разрешение.
 *
 * Свойство проверяется на самом адаптере, потому что портится оно именно здесь: у
 * вызывающих стоят свои `catch`, и вернуть глушилку сюда одной строкой — ровно та
 * правка, от которой тест обязан покраснеть.
 */
const h = vi.hoisted(() => ({
  reply: null as null | Record<string, unknown> | 'throw',
}))

vi.mock('@/shared/core-transport', () => ({ coreTransport: () => ({}), mirrorPushTimeoutMs: () => 1000 }))
vi.mock('@connectrpc/connect', async (orig) => ({
  ...(await orig<typeof import('@connectrpc/connect')>()),
  createClient: () => ({
    getBranchSnapshot: async () => {
      if (h.reply === 'throw') throw new Error('connection reset')
      return h.reply
    },
  }),
}))

const { gitCoreRemote } = await import('@/features/git/core.remote')
const { GitTransportError } = await import('@/core')

const read = () => gitCoreRemote.branchSnapshot({ owner: 'o', slug: 's' }, 'feature-1')

describe('чтение снимка ветки', () => {
  it('⚠️ ядро не ответило — это отказ, а не пустой ответ', async () => {
    h.reply = 'throw'
    await expect(read(), 'глушилка здесь открывает стража команд на слиянии').rejects.toBeInstanceOf(GitTransportError)
  })

  it('ядро ответило «не нашлось» — вот это и есть null', async () => {
    h.reply = { found: false }
    await expect(read()).resolves.toBeNull()
  })

  it('ветка есть — снимок разбирается как обычно', async () => {
    h.reply = { found: true, tipSha: 'abc123', title: 'список', desc: '', tags: [], ordered: false, steps: [] }
    await expect(read()).resolves.toMatchObject({ tipSha: 'abc123' })
  })
})
