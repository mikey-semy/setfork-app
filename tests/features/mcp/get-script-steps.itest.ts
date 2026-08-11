import { randomUUID } from 'node:crypto'
import { sql } from 'drizzle-orm'
import { beforeAll, describe, expect, it } from 'vitest'
import { db, steps, templateVersions, templates, users } from '@/shared/db'
import { mcpGetList, mcpGetScript } from '@/features/mcp/tools'
import { resetTables } from '../../helpers/reset-db'

/**
 * Сквозной путь «справочник → скрипт из нужных пунктов»: строки БД → detail →
 * ExportList → скрипт. Юнит-тесты проверяют сборку скрипта на готовой структуре,
 * а здесь важно другое — что АДРЕС блока (bid) и пометка разрушительности
 * доезжают из базы до движка. Именно на этом стыке поле теряется молча.
 */

let ownerId = ''
const SLUG = 'server-maintenance'
const BIDS = { disk: randomUUID(), logs: randomUUID(), prune: randomUUID(), restart: randomUUID() }

beforeAll(async () => {
  await resetTables([steps, templateVersions, templates, users])
  const [u] = await db.insert(users).values({ handle: 'ops' }).returning({ id: users.id })
  ownerId = u.id
  const [t] = await db
    .insert(templates)
    .values({ ownerId, slug: SLUG, title: { en: 'Server maintenance' }, status: 'published', currentVersion: 1 })
    .returning({ id: templates.id })
  const [v] = await db
    .insert(templateVersions)
    .values({ templateId: t.id, version: 1, note: 'initial' })
    .returning({ id: templateVersions.id })
  await db.insert(steps).values([
    { versionId: v.id, n: 1, blockId: BIDS.disk, title: { en: 'Check disk' }, command: 'df -h' },
    { versionId: v.id, n: 2, blockId: BIDS.logs, title: { en: 'Show logs' }, command: 'journalctl -u app -n 100' },
    // Пометка автора стоит явно — как её поставил бы человек в редакторе.
    { versionId: v.id, n: 3, blockId: BIDS.prune, title: { en: 'Free volumes' }, command: 'docker system prune -a --volumes', danger: true },
    {
      versionId: v.id,
      n: 4,
      blockId: BIDS.restart,
      title: { en: 'Restart app' },
      command: 'systemctl restart app',
      subtasks: [{ en: 'service answers 200' }],
    },
  ])
})

describe('get_script по адресам пунктов', () => {
  it('get_list отдаёт адреса и пометку — по ним и заказывают пункты', async () => {
    const list = await mcpGetList(ownerId, 'ops', SLUG)
    const blocks = list!.steps as { bid?: string; danger?: boolean; dangerHint?: string }[]
    expect(blocks.map((b) => b.bid)).toEqual([BIDS.disk, BIDS.logs, BIDS.prune, BIDS.restart])
    expect(blocks[2].danger).toBe(true)
    // У непомеченных пометки нет и подсказки тоже: команды безобидные.
    expect(blocks[0].danger).toBeUndefined()
    expect(blocks[0].dangerHint).toBeUndefined()
  })

  it('без адресов — весь список, как раньше', async () => {
    const r = await mcpGetScript(ownerId, 'ops', SLUG)
    expect(r).not.toBeNull()
    expect('error' in r! ? r!.error : '').toBe('')
    const script = (r as { script: string }).script
    expect(script).toContain('df -h')
    expect(script).toContain('journalctl -u app -n 100')
  })

  it('один адрес — скрипт из одной команды', async () => {
    const r = (await mcpGetScript(ownerId, 'ops', SLUG, 'sh', [BIDS.logs])) as {
      script: string
      included: { bid?: string | null }[]
      url: string
    }
    expect(r.script).toContain('journalctl -u app -n 100')
    expect(r.script).not.toContain('df -h')
    expect(r.included.map((s) => s.bid)).toEqual([BIDS.logs])
    // Ссылка ведёт туда же, откуда взят скрипт, — с тем же выбором пунктов.
    expect(r.url).toContain(`bid=${BIDS.logs}`)
  })

  it('разрушительный пункт приезжает закомментированным и назван в skipped', async () => {
    const r = (await mcpGetScript(ownerId, 'ops', SLUG, 'sh', [BIDS.prune, BIDS.restart])) as {
      script: string
      skipped: { bid?: string | null; reason: string }[]
      included: { bid?: string | null }[]
    }
    expect(r.script).toContain('# docker system prune -a --volumes')
    expect(r.script).not.toMatch(/^docker system prune/m)
    expect(r.skipped.map((s) => s.bid)).toEqual([BIDS.prune])
    expect(r.included.map((s) => s.bid)).toEqual([BIDS.restart])
    // Подпункты — проверки ПОСЛЕ команды.
    expect(r.script.indexOf('systemctl restart app')).toBeLessThan(r.script.indexOf('service answers 200'))
  })

  it('неизвестный адрес — явный отказ, а не тихо весь список', async () => {
    const r = (await mcpGetScript(ownerId, 'ops', SLUG, 'sh', ['00000000-0000-0000-0000-000000000000'])) as {
      error?: string
    }
    expect(r.error).toContain('no such block')
  })
})
