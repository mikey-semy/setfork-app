// РЕЕСТР ИНСТРУМЕНТОВ MCP: состав и вшитая авторизация.
//
// Скоуп проверяется не в каждом инструменте, а в способе регистрации (`kit`): read-токен
// не должен доходить до мутирующего вызова. Раньше это свойство держалось только на
// внимательности — ни один тест не падал, если новый writeTool заводили мимо обёртки.
//
// Заодно фиксируется САМ СОСТАВ: инструменты — публичный контракт для агентов, и
// пропажа или переименование обязаны быть видны как падение, а не как тихое изменение
// поверхности.
import { describe, expect, it } from 'vitest'
import { registerTools } from '@/features/mcp/registry'

type Captured = { name: string; config: { description?: string; annotations?: Record<string, unknown> }; cb: (args: unknown, extra: unknown) => Promise<{ content: { text: string }[]; isError?: boolean }> }

function collect(): Captured[] {
  const tools: Captured[] = []
  const server = {
    registerTool: (name: string, config: Captured['config'], cb: Captured['cb']) => tools.push({ name, config, cb }),
  }
  registerTools(server as unknown as Parameters<typeof registerTools>[0])
  return tools
}

const READ_TOKEN = { authInfo: { scopes: ['read'], extra: { userId: 'u1' } } }
const ANONYMOUS = {}

/** Состав поверхности. Меняется он — меняется и этот список, осознанно. */
const EXPECTED = [
  // чтение
  'search_lists', 'get_list', 'get_script', 'get_run',
  // гномы и совет
  'list_gnomes', 'ask_gnome', 'gnome_review', 'get_council_draft', 'council_draft',
  // списки
  'create_list', 'update_list', 'patch_list', 'publish_draft', 'discard_draft', 'delete_list', 'bulk_create_lists',
  // полки и разбор черновиков: чем владелец раскладывает библиотеку
  'my_catalogs', 'my_drafts', 'publish_lists',
  // предложения и проверки
  'pending_suggestions', 'apply_suggestion', 'suggest_edit', 'review_suggestion', 'merge_suggestion', 'revert_suggestion', 'report_check',
  // источники и прогоны
  'register_source', 'list_sources', 'start_run', 'check_step', 'report_run',
  // задачи: заметил и сказал, не берясь чинить
  'search_issues', 'get_issue', 'create_issue', 'add_issue_comment', 'close_issue', 'reopen_issue',
]

describe('реестр MCP: состав', () => {
  const tools = collect()

  it('зарегистрированы все инструменты и ни один не задвоился', () => {
    const names = tools.map((t) => t.name)
    expect(names.length).toBe(new Set(names).size)
    expect([...names].sort()).toEqual([...EXPECTED].sort())
  })

  it('каждый инструмент из ожидаемого состава на месте', () => {
    const names = new Set(tools.map((t) => t.name))
    for (const n of EXPECTED) expect(names.has(n), `пропал инструмент ${n}`).toBe(true)
  })

  it('у каждого инструмента есть подсказки агенту — иначе он гадает, что тот делает', () => {
    for (const t of tools) {
      expect(t.config.annotations, `нет annotations у ${t.name}`).toBeTruthy()
      expect(typeof t.config.annotations?.readOnlyHint, `нет readOnlyHint у ${t.name}`).toBe('boolean')
    }
  })
})

/**
 * Кто именно только читает. Список задан НЕЗАВИСИМО от аннотаций самого
 * инструмента, и это принципиально: выводить его из `readOnlyHint` — значит
 * проверять код им же самим. Заведи кто-нибудь `delete_list` через `readTool`,
 * вывод из аннотации назвал бы его читающим и проверять было бы нечего.
 */
const READ_ONLY = [
  'search_lists', 'get_list', 'get_script', 'get_run',
  'list_gnomes', 'get_council_draft',
  'pending_suggestions', 'list_sources',
  'search_issues', 'get_issue',
  // «что у меня лежит неопубликованным» и «какие у меня полки» — чтение: ничего не
  // меняют и денег не тратят
  'my_catalogs', 'my_drafts',
]

/**
 * ТРАТИТ ДЕНЬГИ — значит не чтение, чем бы оно ни выглядело снаружи.
 *
 * `ask_gnome` и `gnome_review` спрашивают модель: проверяют `globalBudgetOk` и
 * `aiQuota`, пишут `recordUsage`. Числились читающими — то есть утёкший read-токен
 * жёг бюджет владельца и инстанса. `council_draft`, ровно такой же по природе, всё
 * это время был пишущим: расхождение и выдало ошибку.
 */
const SPENDS_MONEY = ['ask_gnome', 'gnome_review', 'council_draft']

describe('реестр MCP: вшитая авторизация', () => {
  const tools = collect()

  it('читающие помечены readOnlyHint, пишущие — нет', () => {
    for (const t of tools) {
      expect(t.config.annotations?.readOnlyHint, t.name).toBe(READ_ONLY.includes(t.name))
    }
  })

  it('ни один инструмент, тратящий деньги, не числится читающим', () => {
    for (const name of SPENDS_MONEY) {
      expect(READ_ONLY.includes(name), `${name} тратит квоту и не может быть читающим`).toBe(false)
      expect(tools.find((t) => t.name === name)?.config.annotations?.readOnlyHint, name).toBe(false)
    }
  })

  it('read-токен не доходит ни до одного мутирующего инструмента', async () => {
    const writes = tools.filter((t) => !READ_ONLY.includes(t.name))
    expect(writes.length).toBeGreaterThan(0)
    for (const t of writes) {
      const res = await t.cb({}, READ_TOKEN)
      expect(res.isError, `${t.name} впустил read-токен`).toBe(true)
      expect(res.content[0].text, `${t.name}`).toContain('read-only')
    }
  })

  it('без токена не работает ничего — ни чтение, ни запись', async () => {
    for (const t of tools) {
      const res = await t.cb({}, ANONYMOUS)
      expect(res.isError, `${t.name} ответил анониму`).toBe(true)
      expect(res.content[0].text).toBe('Unauthorized')
    }
  })
})

/**
 * ОПИСАНИЯ — ЭТО ДОКУМЕНТАЦИЯ ДЛЯ АГЕНТА, а не подпись к кнопке.
 *
 * Агент выбирает инструмент и строит вызов по одному тексту: если там не сказано, что у
 * списка есть ВЕРСИЯ, он будет считать ref неподвижным; если не сказано про baseVersion —
 * перезапишет чужую правку и не узнает об этом.
 *
 * Проверяются два свойства, которые ломаются молча:
 *  1) описание есть и оно не заглушка — пустое поле в реестре не падает нигде;
 *  2) там, где агент работает с содержимым списка, версия названа. Это ловится не
 *     вычиткой, а списком: инструмент добавили — либо он в списке и обязан говорить о
 *     версии, либо его туда осознанно не внесли.
 */
const MUST_MENTION_VERSION = [
  'get_list',
  'create_list',
  'update_list',
  'patch_list',
  'publish_draft',
  'suggest_edit',
  'apply_suggestion',
  'merge_suggestion',
  'search_lists',
]

describe('описания инструментов', () => {
  const tools = collect()

  it('у каждого инструмента есть непустое описание', () => {
    const bad = tools.filter((t) => (t.config.description ?? '').trim().length < 40).map((t) => t.name)
    expect(bad, 'описание — единственное, по чему агент выбирает инструмент').toEqual([])
  })

  it('инструменты, работающие с содержимым списка, называют версию', () => {
    const silent = MUST_MENTION_VERSION.filter((name) => {
      const d = tools.find((t) => t.name === name)?.config.description ?? ''
      return !/version/i.test(d)
    })
    expect(silent, 'без слова о версии агент считает ref неподвижным').toEqual([])
  })
})
