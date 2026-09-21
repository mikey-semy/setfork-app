import { beforeEach, describe, expect, it, vi } from 'vitest'

// Порядок последствий записи версии НАГРУЖЕН, и это выяснилось на ревью fe#751.
// Авто-мёрдж на кураторском списке помечает предложение принятым; если делать это
// ПОСЛЕ уведомлений, то сбой уведомления или переиндексации оставит предложение
// открытым при уже записанной версии — и следующий проход садовника смёржит его
// повторно, второй такой же версией.
//
// Тест держит именно порядок, а не факт вызова: перестановка двух строк местами
// проходит любую проверку «всё вызвано».

const calls: string[] = []
/** Что уехало в ядро последним вызовом — по нему видно, назвал ли садовник свою базу. */
const seen: { input?: { expectedVersion?: number } } = {}

vi.mock('@/features/library/list-store', () => ({
  listStore: {
    addVersion: vi.fn(async (_id: string, input: { expectedVersion?: number }) => {
      calls.push('addVersion')
      seen.input = input
    }),
  },
}))
vi.mock('@/features/watch/queries', () => ({
  getWatcherIds: vi.fn(async () => { calls.push('getWatcherIds'); return ['w1'] }),
}))
vi.mock('@/features/notifications/notify', () => ({
  notifyMany: vi.fn(async () => { calls.push('notifyMany') }),
}))
vi.mock('@/features/library/jobs', () => ({
  enqueueReindex: vi.fn(async () => { calls.push('enqueueReindex') }),
}))
vi.mock('@/shared/lib/step-input', () => ({ toStepInput: (x: unknown) => x }))

const { ListWriteError } = await import('@/core')
const { publishGardenerVersion } = await import('@/features/gardener/sweep/publish')

const items = [] as never[]

describe('publishGardenerVersion — порядок последствий', () => {
  beforeEach(() => {
    calls.length = 0
  })

  it('запись версии → afterVersion → уведомление → переиндексация', async () => {
    await publishGardenerVersion('t1', items, {
      note: 'n',
      authorId: 'a1',
      expectedVersion: 5,
      afterVersion: async () => { calls.push('afterVersion') },
    })
    expect(calls).toEqual(['addVersion', 'afterVersion', 'getWatcherIds', 'notifyMany', 'enqueueReindex'])
  })

  it('сбой уведомления НЕ отменяет afterVersion: предложение уже помечено принятым', async () => {
    const { notifyMany } = await import('@/features/notifications/notify')
    vi.mocked(notifyMany).mockImplementationOnce(async () => {
      throw new Error('уведомления недоступны')
    })
    await expect(
      publishGardenerVersion('t1', items, {
        note: 'n',
        authorId: 'a1',
        expectedVersion: 5,
        afterVersion: async () => { calls.push('afterVersion') },
      }),
    ).rejects.toThrow('уведомления недоступны')
    // Версия записана и предложение помечено — несогласованного состояния нет.
    expect(calls).toContain('afterVersion')
    expect(calls.indexOf('afterVersion')).toBeLessThan(calls.indexOf('getWatcherIds'))
  })

  it('без afterVersion порядок прежний', async () => {
    await publishGardenerVersion('t1', items, { note: 'n', authorId: 'a1', expectedVersion: 5 })
    expect(calls).toEqual(['addVersion', 'getWatcherIds', 'notifyMany', 'enqueueReindex'])
  })
})

/**
 * СВЕРКА ВЕРСИИ У САДОВНИКА. Проход читает состав, ходит в модель десятки секунд и пишет
 * версию — а между чтением и записью владелец успевает опубликовать своё. Механизм защиты
 * существовал и применялся соседями (публикация черновика, patch_list), но этот маршрут
 * его не звал: последняя запись побеждала, и правка человека исчезала из текущей версии
 * молча, при обоих «успехах».
 *
 * Здесь же проверяется ВТОРАЯ половина решения: отказ отдаётся ЗНАЧЕНИЕМ. Исключение
 * оборвало бы партию — проход идёт по спискам подряд, и гонка на одном не должна лишать
 * ухода остальные.
 */
describe('publishGardenerVersion — сверка версии', () => {
  beforeEach(() => {
    calls.length = 0
    seen.input = undefined
  })

  it('база, из которой прочитан состав, уезжает в ядро', async () => {
    await publishGardenerVersion('t1', items, { note: 'n', authorId: 'a1', expectedVersion: 7 })
    expect(seen.input?.expectedVersion, 'без базы ядро сверять нечем — победит последняя запись').toBe(7)
  })

  it('список ушёл вперёд → версии нет, последствий тоже нет, и это НЕ исключение', async () => {
    const { listStore } = await import('@/features/library/list-store')
    vi.mocked(listStore.addVersion).mockImplementationOnce(async () => {
      throw new ListWriteError('stale')
    })
    const calledAfter = vi.fn(async () => { calls.push('afterVersion') })

    const res = await publishGardenerVersion('t1', items, { note: 'n', authorId: 'a1', expectedVersion: 7, afterVersion: calledAfter })

    expect(res).toBe('stale')
    // Ни пометки предложения принятым, ни уведомлений, ни переиндексации: версии нет,
    // значит и последствий записи быть не должно.
    expect(calledAfter).not.toHaveBeenCalled()
    expect(calls).toEqual([])
  })

  it('прочие отказы записи наружу, а не под ковёр', async () => {
    const { listStore } = await import('@/features/library/list-store')
    vi.mocked(listStore.addVersion).mockImplementationOnce(async () => {
      throw new ListWriteError('out-of-sync')
    })
    await expect(publishGardenerVersion('t1', items, { note: 'n', authorId: 'a1', expectedVersion: 7 })).rejects.toThrow('out-of-sync')
  })
})
