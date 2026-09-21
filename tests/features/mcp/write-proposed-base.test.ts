import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * БАЗА ПРАВКИ ДОЕЗЖАЕТ ДО ЯДРА — и это доказуемо без базы данных.
 *
 * `writeProposed` — единственная дверь обоих пишущих инструментов в ядро. Сверку делает
 * ядро, а здесь проверяется то единственное, за что отвечает фронт: что число, присланное
 * агентом, действительно уехало в вызов, а не потерялось по дороге.
 *
 * Почему именно так, а не итестом. Ранний отсев в `update_list` стоит строкой выше вызова
 * и отбивает всё, что не равно текущей версии, — значит в точке вызова `baseVersion` и
 * текущая версия РАВНЫ ВСЕГДА, и подмена одного другим не наблюдаема ни с какой стороны:
 * ни юнитом, ни итестом, ни в проде. Такая мутация эквивалентна, и гоняться за ней
 * интеграционным окружением бессмысленно. Наблюдаемо здесь другое — сам факт передачи
 * седьмого аргумента; он и проверяется, как у садовника в `publish-order.test.ts`.
 */

const h = vi.hoisted(() => ({
  seen: null as null | { expectedVersion?: number },
  refuseWith: null as null | Error,
}))

// Подменяем ВНЕШНЕЕ: порт записи и резолвер адреса (он ходит в базу). Сам `writeProposed`
// работает по-настоящему — иначе проверялась бы подмена, а не код.
vi.mock('@/shared/db', () => ({ db: {}, templates: {} }))
vi.mock('@/features/mcp/tools/shared', () => ({ resolveListRefOrMoved: vi.fn(async () => null) }))
vi.mock('@/features/library/jobs', () => ({ enqueueReindex: vi.fn() }))
vi.mock('@/features/library/list-store', () => ({
  listStore: {
    addVersion: vi.fn(async (_id: string, input: { expectedVersion?: number }) => {
      h.seen = input
      if (h.refuseWith) throw h.refuseWith
      return { version: 8 }
    }),
  },
}))

const { ListWriteError } = await import('@/core')
const { writeProposed } = await import('@/features/mcp/tools/lists/write')

const tpl = { id: 't1', status: 'published', tags: ['x'], ordered: true } as unknown as Parameters<typeof writeProposed>[0]
const items = [{ type: 'step', title: { en: 'install' } }] as unknown as Parameters<typeof writeProposed>[3]
const meta = { tags: ['x'], ordered: true }

beforeEach(() => {
  h.seen = null
  h.refuseWith = null
})

describe('общая половина записи называет ядру базу', () => {
  it('присланное агентом число уезжает в addVersion как expectedVersion', async () => {
    await writeProposed(tpl, 'me', 'spisok', items, 'note', meta, 5)
    expect(h.seen?.expectedVersion, 'без этого ядру нечего сверять — победит последняя запись').toBe(5)
  })

  it('едет именно ТО число, что дали, а не выдуманное на месте', async () => {
    await writeProposed(tpl, 'me', 'spisok', items, 'note', meta, 12)
    expect(h.seen?.expectedVersion).toBe(12)
  })

  it('отказ ядра по версии превращается в ответ, который учит следующему шагу', async () => {
    h.refuseWith = new ListWriteError('stale')
    const res = await writeProposed(tpl, 'me', 'spisok', items, 'note', meta, 5)
    expect(res).toMatchObject({ error: expect.stringContaining('list changed') })
    expect((res as { error: string }).error).toMatch(/get_list/)
  })

  it('расхождение git и базы — другой отказ, и он учит НЕ повторять', async () => {
    h.refuseWith = new ListWriteError('out-of-sync')
    const res = await writeProposed(tpl, 'me', 'spisok', items, 'note', meta, 5)
    expect((res as { error: string }).error).toMatch(/do not retry/)
  })
})
