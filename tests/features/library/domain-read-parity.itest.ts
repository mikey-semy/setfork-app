import { beforeAll, describe, expect, it } from 'vitest'

/**
 * ПАРИТЕТ ЧТЕНИЯ через домен: что лежит в БД, то и отдаёт ядро.
 *
 * Долг катовера: `SETFORK_DOMAIN_READS=1` подменяет локальный Postgres-адаптер
 * чтением из Rust-ядра (`listReadRemote`). Мапперы у них РАЗНЫЕ и перечисляют
 * поля руками, поэтому поле, о котором знает один, второй молча теряет — типы
 * не помогают, поля опциональные.
 *
 * Так и вышло: 12.08 в локальном адаптере починили `danger` (D2 линзы 05), а в
 * удалённом не хватало ТРЁХ полей — `needs_human`, `needs_human_ask`, `danger`,
 * причём все три ядро присылает (`domain_read.proto` 15, 16, 17). Ровно тот путь,
 * ради которого правка и делалась, оставался сломанным. В `proto/git.proto:389`
 * про этот корень написано прямо: «этот баг уже чинили дважды — с needs_human и
 * danger»; это третий раз.
 *
 * Требует ЖИВОГО ядра — без него пропускается, а не притворяется зелёным.
 */
const CORE = process.env.SETFORK_CORE_ADDR
const description = CORE ? describe : describe.skip

const { db, templates, users } = await import('@/shared/db')
const { listStore } = await import('@/features/library/list-store')
const { listReadRemote } = await import('@/features/library/list-store.remote')
const { toStepInput } = await import('@/shared/lib/step-input')
const { resetTables } = await import('../../helpers/reset-db')

let ownerId = ''

beforeAll(async () => {
  if (!CORE) return
  await resetTables([templates, users])
  const [u] = await db.insert(users).values({ handle: 'dr-owner' }).returning({ id: users.id })
  ownerId = u.id
})

description('паритет чтения: локальный адаптер и ядро отдают одно и то же', () => {
  it('пометки доезжают обоими путями', async () => {
    const steps = toStepInput([
      {
        title: { ru: 'Снести окружение' },
        desc: {},
        command: 'make reset',
        hasImage: false,
        level: 'required',
        why: {},
        section: {},
        subtasks: [],
        refs: [],
        danger: true,
        needsHuman: true,
        needsHumanAsk: { ru: 'Сколько это стоит у вас?' },
      },
    ])
    const list = await listStore.create({
      ownerId, slug: 'read-parity', title: { ru: 'Паритет чтения' }, desc: {}, tags: [],
      ordered: true, visibility: 'public', status: 'draft', origin: 'ai_draft', note: 'seed', steps,
    })

    const local = (await listStore.getVersion(list.id, 1))?.steps[0]
    const remote = (await listReadRemote.getVersion(list.id, 1))?.steps[0]
    expect(local, 'локальное чтение не вернуло версию').toBeTruthy()
    expect(remote, 'ядро не вернуло версию').toBeTruthy()

    // Сравниваем ПОВЕДЕНИЕ, а не списки имён: обе пометки обязаны пережить оба пути.
    for (const [path, s] of [['локальный адаптер', local], ['ядро', remote]] as const) {
      expect(s?.danger, `${path}: потеряна пометка «разрушительный пункт»`).toBe(true)
      expect(s?.needsHuman, `${path}: потеряна пометка «здесь нужен человек»`).toBe(true)
      expect(s?.needsHumanAsk, `${path}: потерян вопрос к человеку`).toMatchObject({ ru: 'Сколько это стоит у вас?' })
    }
  })
})
