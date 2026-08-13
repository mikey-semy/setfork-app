import { beforeAll, describe, expect, it } from 'vitest'
import { db, steps as stepsTable, templates, templateVersions, users, type ProposedItem } from '@/shared/db'
import { listStore } from '@/features/library/list-store'
import { toStepInput } from '@/shared/lib/step-input'
import { and, eq } from 'drizzle-orm'
import { resetTables } from '../../helpers/reset-db'

// «Разрушительный пункт» — второй уровень защиты исполняемого выхода: команда с
// пометкой приезжает в собранный скрипт ЗАКОММЕНТИРОВАННОЙ. Первый уровень
// (destructive-command.ts) вовсе не пускает в публикацию команды без законного
// применения (`rm -rf /`), а `docker system prune -a --volumes` законна — её и
// ловит пометка.
//
// Пометку ставит АВТОР (редактор, MCP), то есть она приходит уже в ProposedItem:
// модель её не возвращает — в `GeneratedItem` такого поля нет вовсе, и на записи
// `toStepInput` при отсутствии флага решает по шаблону команды.
//
// Проверять надо на БД и через ПОРТ: адаптер перечисляет поля руками, `Step.danger`
// в доменном типе есть, а чтение его не заполняло. Путь холодный (флаги
// SETFORK_DOMAIN_* выключены), поэтому потеря не проявлялась — включили бы флаг, и
// второй уровень защиты исчез бы молча. Линза 05, находка D2.

let ownerId = ''

beforeAll(async () => {
  await resetTables([templates, users])
  const [u] = await db.insert(users).values({ handle: 'dg-owner' }).returning({ id: users.id })
  ownerId = u.id
})

/** Пункт от автора: пометка стоит вручную, команда сама по себе безобидна. */
const authored = (over: Partial<ProposedItem> = {}): ProposedItem => ({
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
  ...over,
})

describe('пометка «разрушительный пункт» сквозь хранилище', () => {
  it('create → чтение версии через порт: пометка автора на месте', async () => {
    const steps = toStepInput([authored(), authored({ title: { ru: 'Проверить статус' }, command: 'docker ps', danger: false })])
    const list = await listStore.create({ ownerId, slug: 'ops', title: { ru: 'Эксплуатация' }, desc: {}, tags: ['ops'], ordered: true, visibility: 'public', status: 'draft', origin: 'ai_draft', note: 'seed', steps })

    // Сырые строки — контрольная точка: нет пометки уже здесь, значит ломается
    // ЗАПИСЬ, и тест укажет на другой участок, а не на чтение.
    const [v] = await db.select().from(templateVersions).where(and(eq(templateVersions.templateId, list.id), eq(templateVersions.version, 1))).limit(1)
    const rows = await db.select().from(stepsTable).where(eq(stepsTable.versionId, v.id)).orderBy(stepsTable.n)
    expect(rows[0].danger, 'пометка не доехала до БД — ломается запись, а не чтение').toBe(true)

    const read = await listStore.getVersion(list.id, 1)
    expect(read?.steps[0].danger).toBe(true)
    expect(read?.steps[1].danger ?? false).toBe(false)
  })
})

// Сторож на КОРЕНЬ, а не на симптом. `toStep` в адаптере перечисляет поля руками,
// и это уже третий случай, когда рукописный перенос теряет поле молча: пометка
// «нужен человек» стиралась проходом ухода (инцидент R1, рунбук
// list-field-paths.md), идентичность блока разъехалась на три ответа (D1), теперь
// `danger` не доезжал через порт (D2). Типы не спасают: поля опциональные.
describe('порт не теряет поля шага', () => {
  it('всё, что записали, читается обратно', async () => {
    const steps = toStepInput([
      authored({
        title: { ru: 'Полный шаг' },
        desc: { ru: 'описание' },
        command: 'echo 1',
        level: 'optional',
        why: { ru: 'зачем' },
        section: { ru: 'Раздел' },
        subtasks: [{ ru: 'под 1' }],
        refs: [{ label: { ru: 'док' }, url: 'https://example.com' }],
        needsHuman: true,
        needsHumanAsk: { ru: 'вопрос' },
      }),
    ])
    const list = await listStore.create({ ownerId, slug: 'parity', title: { ru: 'Паритет' }, desc: {}, tags: [], ordered: true, visibility: 'public', status: 'draft', origin: 'ai_draft', note: 'seed', steps })

    const step = (await listStore.getVersion(list.id, 1))?.steps[0]
    expect(step, 'версия не прочиталась').toBeTruthy()

    // Ожидания перечислены явно: молчаливое `undefined` — это и есть та потеря,
    // которую сторож обязан ловить.
    expect(step).toMatchObject({
      title: { ru: 'Полный шаг' },
      desc: { ru: 'описание' },
      command: 'echo 1',
      level: 'optional',
      why: { ru: 'зачем' },
      section: { ru: 'Раздел' },
      needsHuman: true,
      danger: true,
    })
    expect(step?.subtasks?.[0]).toMatchObject({ ru: 'под 1' })
    expect(step?.refs?.[0]?.url).toBe('https://example.com')
  })
})
