import { Code, ConnectError } from '@connectrpc/connect'
import { describe, expect, it, vi } from 'vitest'

/**
 * ПРИЧИНА ОТКАЗА НА РОЖДЕНИИ СПИСКА ДОХОДИТ ДО ЧЕЛОВЕКА.
 *
 * Найдено вертикалью «собрать список» 27.08.2026, и найдено с двух сторон сразу — это и
 * был смысл оси. У ПРАВКИ перевод отказа в доменную ошибку был (`callAddVersion` читает
 * трейлер `sf-reason`), у РОЖДЕНИЯ не было ничего: `writeClient.create` звался голым,
 * любой отказ ядра приходил сырым `ConnectError`, а действие ловит только отказ стража
 * исполняемых команд — значит человек получал страницу ошибки Next вместо причины.
 *
 * Мало того, сверка на живом стенде показала, что и трейлера на этом пути не было:
 * `Create` отдавал `AlreadyExists` с ПУСТЫМИ метаданными. Обёртка, написанная раньше,
 * читала бы пустоту. Причину `EXISTS` ядро ставит с core#131.
 *
 * Проверяем именно ТРЕЙЛЕР, а не код. На `AlreadyExists` проверка прошла бы и до правки
 * ядра, ничего не проверив, — тот же капкан, в который сегодня уже попадала проверка
 * порядка записей: зелёное без правки означает, что проверка не проверяет.
 */

const h = vi.hoisted(() => ({ fail: null as null | ConnectError }))

vi.mock('@/shared/core-transport', () => ({ coreTransport: () => ({}) }))
vi.mock('@connectrpc/connect', async (orig) => {
  const real = await orig<typeof import('@connectrpc/connect')>()
  return {
    ...real,
    createClient: () => ({
      create: async () => {
        if (h.fail) throw h.fail
        return { id: 'x', slug: 's', title: {}, desc: {}, tags: [], steps: [] }
      },
      addVersion: async () => ({}),
    }),
  }
})

const { listWriteRemote } = await import('@/features/library/list-store.remote')
const { ListWriteError } = await import('@/core')

const input = {
  ownerId: 'u1',
  slug: 'zanyatyj-adres',
  title: { ru: 'Занятый адрес' },
  desc: {},
  tags: [],
  ordered: true,
  visibility: 'public' as const,
  status: 'draft' as const,
  origin: 'manual' as const,
  note: '',
  steps: [],
}

const withTrailer = (reason: string) => {
  const e = new ConnectError('already exists', Code.AlreadyExists)
  e.metadata.set('sf-reason', reason)
  return e
}

describe('отказ на рождении списка', () => {
  it('занятый адрес приходит доменной причиной, а не сырым отказом транспорта', async () => {
    h.fail = withTrailer('EXISTS')
    await expect(listWriteRemote.create(input)).rejects.toBeInstanceOf(ListWriteError)
    await expect(listWriteRemote.create(input)).rejects.toMatchObject({ code: 'exists' })
  })

  it('чужая причина в трейлере НЕ выдаётся за занятый адрес', async () => {
    // Смысл: обёртка не должна глотать всё подряд. Неизвестная причина обязана дойти
    // сырой — тогда её увидит следующий разбор, а не спрячет вежливый текст «адрес занят».
    h.fail = withTrailer('SOMETHING_ELSE')
    await expect(listWriteRemote.create(input)).rejects.not.toBeInstanceOf(ListWriteError)
  })

  it('отказ БЕЗ трейлера не превращается в причину по коду', async () => {
    // Так вело себя ядро до core#131: `AlreadyExists` с пустыми метаданными. Страховаться
    // по коду здесь нельзя — `AlreadyExists` носят и другие отказы, и «угадывание по коду»
    // вернуло бы ровно ту ошибку, из-за которой в core.remote.ts запрещено разбирать текст.
    h.fail = new ConnectError('already exists', Code.AlreadyExists)
    await expect(listWriteRemote.create(input)).rejects.not.toBeInstanceOf(ListWriteError)
  })
})
