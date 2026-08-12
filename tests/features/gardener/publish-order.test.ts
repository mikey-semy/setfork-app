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

vi.mock('@/features/library/list-store', () => ({
  listStore: { addVersion: vi.fn(async () => { calls.push('addVersion') }) },
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
        afterVersion: async () => { calls.push('afterVersion') },
      }),
    ).rejects.toThrow('уведомления недоступны')
    // Версия записана и предложение помечено — несогласованного состояния нет.
    expect(calls).toContain('afterVersion')
    expect(calls.indexOf('afterVersion')).toBeLessThan(calls.indexOf('getWatcherIds'))
  })

  it('без afterVersion порядок прежний', async () => {
    await publishGardenerVersion('t1', items, { note: 'n', authorId: 'a1' })
    expect(calls).toEqual(['addVersion', 'getWatcherIds', 'notifyMany', 'enqueueReindex'])
  })
})
