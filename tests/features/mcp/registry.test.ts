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
 * ПОДСКАЗКИ О ПОСЛЕДСТВИЯХ — ПЕРЕЧЕНЬ, А НЕ УМОЛЧАНИЕ.
 *
 * По спецификации MCP `destructiveHint` у пишущего инструмента по умолчанию TRUE, а наш
 * `kit` ставит всем `false`. Это осознанное УТВЕРЖДЕНИЕ «только добавляет», и клиент по
 * нему решает, спрашивать ли человека перед вызовом. Значит перечень тех, кто стирает или
 * заменяет чужое, обязан быть виден и проверяем — иначе тридцать восьмой инструмент
 * приедет с нашим умолчанием и молча получит право не спрашивать.
 *
 * Список задан НЕЗАВИСИМО от аннотаций, как и READ_ONLY выше, и по той же причине.
 */
const DESTRUCTIVE = [
  'update_list', // заменяет ВЕСЬ состав: не переданный блок исчезает
  'patch_list', // среди операций есть delete
  'discard_draft', // выбрасывает накопленные правки
  'delete_list', // необратимо, вместе с версиями и звёздами
  'apply_suggestion', // принятые items становятся новым составом целиком
  'merge_suggestion', // слияние заменяет состав решением сопровождающего
  // ⚠️ Стереть можно не только состав списка. Перезапись ОДНОГО ПОЛЯ — уже не
  // «только добавляет», и первая редакция этого перечня на них и попалась:
  'check_step', // отметка шага стирает заметку к нему (note: '')
  'report_run', // удачный отчёт стирает verified_by — человека за прежний уровень
  'review_suggestion', // заменяет вердикт того же ревьюера и снимает отклонение ревью
  'report_check', // проверка с тем же именем заменяется целиком
  'register_source', // источник с тем же url заменяется, в том числе чужой
  'reopen_issue', // снимает исход закрытия и ссылку на оригинал (в ленте остаются)
]

/**
 * ПОВТОР НИЧЕГО НЕ МЕНЯЕТ — значит клиенту безопасно повторить при обрыве связи.
 * `check_step` сюда НЕ входит специально: без `done` он ПЕРЕКЛЮЧАЕТ шаг, и повтор
 * возвращает его обратно.
 */
const IDEMPOTENT = ['discard_draft', 'delete_list', 'close_issue', 'reopen_issue']
// ⚠️ Флаги НЕЗАВИСИМЫ: `reopen_issue` и разрушающий, и идемпотентный — он снимает
// исход, но повтор на уже открытой задаче не пишет ничего (ранний выход в core.ts).

describe('подсказки о последствиях', () => {
  const tools = collect()
  const writes = tools.filter((t) => !READ_ONLY.includes(t.name))

  it('всё, что стирает или заменяет чужое, объявлено разрушающим', () => {
    for (const name of DESTRUCTIVE) {
      const a = tools.find((t) => t.name === name)?.config.annotations
      expect(a, `инструмент ${name} не найден`).toBeTruthy()
      expect(a?.destructiveHint, `${name} стирает или заменяет чужое`).toBe(true)
    }
  })

  it('остальные пишущие заявлены как добавляющие — осознанно, а не по умолчанию', () => {
    expect(writes.length).toBeGreaterThan(20)
    for (const t of writes) {
      // Подсказка обязана быть ЯВНОЙ у каждого: её отсутствие по спецификации означает
      // «разрушающий», то есть противоположность тому, что мы заявляем.
      expect(typeof t.config.annotations?.destructiveHint, `${t.name}: подсказка не проставлена`).toBe('boolean')
      expect(t.config.annotations?.destructiveHint, `${t.name} заявлен добавляющим — так ли это?`).toBe(DESTRUCTIVE.includes(t.name))
    }
  })

  it('повторяемые вызовы объявлены идемпотентными, а переключатель — нет', () => {
    for (const name of IDEMPOTENT) {
      expect(tools.find((t) => t.name === name)?.config.annotations?.idempotentHint, `${name}: повтор безопасен`).toBe(true)
    }
    expect(tools.find((t) => t.name === 'check_step')?.config.annotations?.idempotentHint, 'check_step ПЕРЕКЛЮЧАЕТ шаг').toBeUndefined()
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
