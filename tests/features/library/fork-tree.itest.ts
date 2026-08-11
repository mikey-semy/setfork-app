import { sql } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { resetTables } from '../../helpers/reset-db'

// Дерево форков против РЕАЛЬНОЙ базы: проверяется сам обход графа, а он весь в SQL —
// на моках такое не проверишь. Контракта этой поверхности в тестах не было вовсе
// (карточка ревью forks/013), при том что она отвечает на вопрос «кто от кого произошёл»
// и обязана не выдавать скрытое.
const { db, templates, users } = await import('@/shared/db')
const { getForkTree } = await import('@/features/library/fork-tree')

let ownerId = ''
let rootId = ''
let seq = 0

/** Список: по умолчанию публичный и опубликованный. */
async function list(slug: string, owner: string, over: Partial<typeof templates.$inferInsert> = {}): Promise<string> {
  const [row] = await db
    .insert(templates)
    .values({ ownerId: owner, slug, title: { ru: slug }, status: 'published', visibility: 'public', ...over })
    .returning({ id: templates.id })
  return row.id
}

/**
 * Форк — ВСЕГДА от нового пользователя: в базе стоит инвариант «один аккаунт — один форк
 * списка» (`templates_owner_fork_uq`, PR #669), и два форка одного родителя от одного
 * владельца просто не создать. Дерево ветвится за счёт разных людей, как и в жизни.
 */
async function fork(slug: string, parent: string, over: Partial<typeof templates.$inferInsert> = {}): Promise<string> {
  const [u] = await db
    .insert(users)
    .values({ handle: `ft-${(seq += 1)}` })
    .returning({ id: users.id })
  return list(slug, u.id, { forkedFromId: parent, origin: 'forked', ...over })
}

/** Плоский список id дерева — для проверок «кто вообще виден». */
const ids = (nodes: { id: string; children: unknown[] }[]): string[] =>
  nodes.flatMap((n) => [n.id, ...ids(n.children as { id: string; children: unknown[] }[])])

beforeEach(async () => {
  await resetTables([templates, users])
  seq = 0
  const [u] = await db.insert(users).values({ handle: 'ft-owner' }).returning({ id: users.id })
  ownerId = u.id
  rootId = await list('root', ownerId)
})

afterAll(async () => {
  await resetTables([templates, users])
})

describe('ветви сохраняются (forks/001)', () => {
  it('внук лежит под своим родителем, а не в общей куче уровня', async () => {
    const a = await fork('a', rootId)
    const b = await fork('b', rootId)
    const aChild = await fork('a-child', a)
    const bChild = await fork('b-child', b)

    const tree = await getForkTree(rootId)

    expect(tree.roots.map((r) => r.id).sort()).toEqual([a, b].sort())
    const nodeA = tree.roots.find((r) => r.id === a)!
    const nodeB = tree.roots.find((r) => r.id === b)!
    expect(nodeA.children.map((c) => c.id)).toEqual([aChild])
    expect(nodeB.children.map((c) => c.id)).toEqual([bChild])
    expect(nodeA.children[0].parentId).toBe(a)
  })
})

describe('скрытый предок не рвёт родословную (forks/005)', () => {
  it('публичный внук остаётся в дереве, подвешенный к ближайшему видимому предку', async () => {
    // A публичный, B — его публичный форк; затем A прячут.
    const a = await fork('a', rootId, { visibility: 'private' })
    const b = await fork('b', a)

    const tree = await getForkTree(rootId)

    expect(ids(tree.roots)).toEqual([b]) // внук на месте
    expect(tree.roots[0].id).toBe(b) // и поднят к корню, раз промежуточный скрыт
    expect(tree.count).toBe(1)
  })

  it('сам скрытый узел наружу не показывается ни строкой, ни отступом', async () => {
    const a = await fork('secret', rootId, { moderation: 'flagged' })
    await fork('grand', a)

    const tree = await getForkTree(rootId)

    expect(ids(tree.roots)).not.toContain(a)
    expect(JSON.stringify(tree)).not.toContain('secret')
  })

  it('скрытый узел ГЛУБЖЕ первого уровня тоже не обрывает ветвь', async () => {
    // Первый уровень читается базовым шагом обхода, дальше работает рекурсивный —
    // и правило видимости обязано быть одинаковым на обоих. Пока проверялся только
    // первый уровень, возврат фильтра в рекурсивный шаг тесты не замечали.
    const a = await fork('a', rootId)
    const hidden = await fork('hidden', a, { visibility: 'private' })
    const deep = await fork('deep', hidden)

    const tree = await getForkTree(rootId)

    expect(ids(tree.roots).sort()).toEqual([a, deep].sort())
    // Внук подвешен к ближайшему ВИДИМОМУ предку — то есть к `a`, а не к корню.
    const nodeA = tree.roots.find((r) => r.id === a)!
    expect(nodeA.children.map((c) => c.id)).toEqual([deep])
  })

  it('черновик и снятый модерацией прозрачны так же, как приватный', async () => {
    const draft = await fork('draft', rootId, { status: 'draft' })
    const underDraft = await fork('under-draft', draft)
    const hidden = await fork('hidden', rootId, { moderation: 'hidden' })
    const underHidden = await fork('under-hidden', hidden)

    const tree = await getForkTree(rootId)

    expect(ids(tree.roots).sort()).toEqual([underDraft, underHidden].sort())
  })
})

describe('обход ограничен и говорит об этом (forks/003, forks/004, forks/007)', () => {
  it('цикл в данных не вешает запрос', async () => {
    // Цикл — это порча данных (связь форка не защищена внешним ключом, forks/006), но
    // обход обязан её пережить, а не крутиться до таймаута. Цикл ставим ВНУТРИ ветви,
    // достижимой от корня: b → c → b, при этом a остаётся ребёнком корня.
    const a = await fork('a', rootId)
    const b = await fork('b', a)
    const c = await fork('c', b)
    await db.execute(sql`update ${templates} set forked_from_id = ${c} where id = ${b}`)

    const tree = await getForkTree(rootId)

    // a виден (он ребёнок корня), b и c — это уже петля: обход её обрывает, но не висит.
    expect(ids(tree.roots)).toContain(a)
    expect(tree.count).toBeGreaterThan(0)
  })

  it('глубже потолка не идёт и помечает усечение', async () => {
    let parent = rootId
    const chain: string[] = []
    for (let i = 0; i < 8; i++) {
      parent = await fork(`deep-${i}`, parent)
      chain.push(parent)
    }

    const tree = await getForkTree(rootId)

    expect(tree.count).toBe(6) // SETFORK_FORK_TREE_MAX_DEPTH по умолчанию
    expect(tree.truncated.depth).toBe(true)
    expect(ids(tree.roots)).not.toContain(chain[7])
  })

  it('лишние дети одного узла обрезаются и помечаются', async () => {
    // Ширина считается оконной функцией ДО LIMIT — иначе флаг усечения был бы всегда
    // ложным, а страница молча показывала бы часть детей как всё дерево.
    process.env.SETFORK_FORK_TREE_MAX_CHILDREN = '2'
    try {
      for (let i = 0; i < 4; i++) await fork(`wide-${i}`, rootId)

      const tree = await getForkTree(rootId)

      expect(tree.count).toBe(2)
      expect(tree.truncated.width).toBe(true)
      expect(tree.truncated.depth).toBe(false)
    } finally {
      delete process.env.SETFORK_FORK_TREE_MAX_CHILDREN
    }
  })

  it('полное дерево усечением не помечается', async () => {
    const a = await fork('a', rootId)
    await fork('a-child', a)

    const tree = await getForkTree(rootId)

    expect(tree.truncated).toEqual({ depth: false, width: false, nodes: false })
  })
})

describe('пустое дерево', () => {
  it('у списка без форков нет ни узлов, ни усечения', async () => {
    const tree = await getForkTree(rootId)
    expect(tree.roots).toEqual([])
    expect(tree.count).toBe(0)
    expect(tree.truncated.nodes).toBe(false)
  })

  it('единственный скрытый форк = пустое дерево, а не намёк на его существование', async () => {
    await fork('hidden-only', rootId, { visibility: 'private' })

    const tree = await getForkTree(rootId)

    expect(tree.roots).toEqual([])
    expect(tree.count).toBe(0)
  })
})

describe('потолок узлов', () => {
  it('лишние узлы отсекаются и помечаются флагом', async () => {
    process.env.SETFORK_FORK_TREE_MAX_NODES = '2'
    try {
      const a = await fork('n1', rootId)
      await fork('n2', rootId)
      await fork('n3', a)

      const tree = await getForkTree(rootId)

      expect(tree.count).toBe(2)
      expect(tree.truncated.nodes).toBe(true)
    } finally {
      delete process.env.SETFORK_FORK_TREE_MAX_NODES
    }
  })
})
