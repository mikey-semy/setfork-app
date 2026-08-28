import { describe, expect, it, vi } from 'vitest'

/**
 * ОТКАЗ НА ВЫПУСКЕ РЕЛИЗА НЕ СТИРАЕТ ЗАМЕТКИ.
 *
 * Отказ уносил переходом на `?e=…`, то есть новым GET, и форма стиралась. Дороже всего
 * в ней заметки: человек мог только что их СГЕНЕРИРОВАТЬ — вызов ИИ, то есть деньги и
 * минуты ожидания. Ошибся в теге — плати ещё раз. Тот же корень, что у формы списка.
 *
 * Мок перехода бросает: так видно попытку уйти со страницы, даже если возвращаемое
 * значение окажется верным.
 */
const h = vi.hoisted(() => ({ tpl: { id: 't1', ownerId: 'u1', slug: 'spisok', currentVersion: 2 } }))

vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw new Error(`переход вместо значения: ${to}`)
  },
}))
vi.mock('next/cache', () => ({ revalidatePath: () => {} }))
vi.mock('@/shared/auth/session', () => ({ requireSession: async () => ({ userId: 'u1', handle: 'user' }) }))
vi.mock('@/features/library/collab', () => ({ isCollaborator: async () => false }))
vi.mock('@/shared/db', () => ({
  db: {
    query: { templates: { findFirst: async () => h.tpl } },
    select: () => ({ from: () => ({ where: () => ({ limit: async () => [] }) }) }),
  },
  templates: {},
  templateVersions: {},
  releases: {},
  users: {},
}))

const { createRelease } = await import('@/features/releases/actions')

const form = (fields: Record<string, string>) => {
  const fd = new FormData()
  for (const [k, v] of Object.entries(fields)) fd.set(k, v)
  return fd
}

/** Заметки, которые нельзя терять: столько же символов, сколько у настоящей генерации. */
const NOTES = 'Что изменилось:\n- первый пункт\n- второй пункт'

describe('отказ на выпуске релиза', () => {
  it('негодный тег — отказ значением, а не переход', async () => {
    expect(await createRelease(h.tpl.id, null, form({ tag: 'не тег!', notes: NOTES }))).toBe('badtag')
  })

  it('зарезервированное имя тега — тоже значением', async () => {
    // `v<N>` заняты автотегами версий; релизу нужен свой.
    expect(await createRelease(h.tpl.id, null, form({ tag: 'v2', notes: NOTES }))).toBe('vreserved')
  })

  it('несуществующая версия — значением', async () => {
    expect(await createRelease(h.tpl.id, null, form({ tag: 'v2.0-rc1', version: '99', notes: NOTES }))).toBe('badversion')
  })
})
