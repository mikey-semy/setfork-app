import { sql } from 'drizzle-orm'
import { beforeAll, describe, expect, it } from 'vitest'
import { db, templates, users } from '@/shared/db'
import { listStore } from '@/features/library/list-store'
import { toProposed, toStepInput } from '@/shared/lib/step-input'
import { resetTables } from '../../helpers/reset-db'

// Пометка «здесь нужен человек» проходит через ЗАПИСЬ И ЧТЕНИЕ хранилища. Проверка нужна
// именно на БД: адаптер перечисляет колонки руками, поэтому новое поле теряется молча —
// типы такого не видят, а в UI выглядит как «модель не пометила».

let ownerId = ''

beforeAll(async () => {
  await resetTables(sql`${templates}, ${users}`)
  const [u] = await db.insert(users).values({ handle: 'nh-owner' }).returning({ id: users.id })
  ownerId = u.id
})

const items = () =>
  toStepInput(
    toProposed(
      [
        { title: 'Купить муку', desc: '', command: '', level: 'required', why: '', subtasks: [], refs: [], needsHuman: true, needsHumanAsk: 'Сколько стоит у вас?' },
        { title: 'Замесить', desc: '', command: '', level: 'required', why: '', subtasks: [], refs: [] },
      ],
      'ru',
    ),
  )

describe('пометка сквозь хранилище', () => {
  it('create → чтение версии: пометка и вопрос на месте, у второго шага пусто', async () => {
    const list = await listStore.create({ ownerId, slug: 'bread', title: { ru: 'Хлеб' }, desc: {}, tags: ['еда'], ordered: true, visibility: 'public', status: 'draft', origin: 'ai_draft', note: 'seed', steps: items() })
    const v = await listStore.getVersion(list.id, 1)
    expect(v?.steps[0]).toMatchObject({ needsHuman: true, needsHumanAsk: { ru: 'Сколько стоит у вас?' } })
    expect(v?.steps[1]).toMatchObject({ needsHuman: false, needsHumanAsk: {} })
  })

  it('addVersion: человек ответил — пометка снята и вопрос погашен', async () => {
    const list = await listStore.create({ ownerId, slug: 'bread-2', title: { ru: 'Хлеб 2' }, desc: {}, tags: ['еда'], ordered: true, visibility: 'public', status: 'draft', origin: 'ai_draft', note: 'seed', steps: items() })
    const answered = items().map((s, i) => (i === 0 ? { ...s, needsHuman: false, needsHumanAsk: {}, desc: { ru: 'Мука 80 ₽/кг в Кирове' } } : s))
    await listStore.addVersion(list.id, { note: 'ответ из опыта', steps: answered, authorId: ownerId })
    const v2 = await listStore.getVersion(list.id, 2)
    expect(v2?.steps[0]).toMatchObject({ needsHuman: false, needsHumanAsk: {} })
    expect(v2?.steps[0].desc).toMatchObject({ ru: 'Мука 80 ₽/кг в Кирове' })
  })
})
