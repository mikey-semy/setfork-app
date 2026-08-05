import 'server-only'
import { sql } from 'drizzle-orm'
import { db, publiclyVisible, templates } from '@/shared/db'
import { envNumber } from '@/shared/env'
import type { LocaleText } from '@/shared/i18n'

/**
 * ДЕРЕВО ФОРКОВ: кто от кого произошёл.
 *
 * Читается страницей `/{handle}/{slug}/forks`, но живёт здесь, а не в ней: страница
 * знает про параметры маршрута и про то, как это показать, а рекурсивный обход графа,
 * политика видимости и границы работы — это модель, и меняются они по своим причинам
 * (карточка ревью forks/008).
 *
 * Три решения, которые здесь приняты явно, потому что раньше получались побочно:
 *
 * 1. **Ветви сохраняются.** Прежний запрос отдавал плоский список с одним лишь
 *    уровнем и сортировкой по свежести — восстановить, чей это внук, было нельзя
 *    (forks/001). Теперь у каждого узла есть родитель, и наружу уходит лес.
 * 2. **Скрытый предок не рвёт родословную.** Если публичный форк A породил публичный B,
 *    а потом A стал приватным, B из дерева ИСЧЕЗАЛ целиком — фильтр видимости стоял
 *    внутри рекурсии и обрывал обход (forks/005). Так у GitHub и не делают: «Public to
 *    private → public forks remain public in separate networks», а при удалении
 *    публичного репозитория «an active public fork becomes the new upstream». То есть
 *    публичный потомок не пропадает, он отвязывается. Мы обходим граф целиком, но
 *    ПОКАЗЫВАЕМ только видимое, подвешивая потомка к ближайшему видимому предку. Факт
 *    существования скрытого узла при этом наружу не идёт — ни строкой, ни отступом.
 * 3. **Обход ограничен по-настоящему.** `LIMIT` во внешнем SELECT обрезал ответ, но не
 *    работу: база всё равно разворачивала весь достижимый граф (forks/003). Границы
 *    теперь стоят внутри обхода — глубина, ширина на узел и потолок узлов, — а то, что
 *    в них не поместилось, помечается флагом усечения, чтобы страница могла об этом
 *    сказать вместо тихой лжи (forks/004).
 */

/** Узел дерева. `parentId` — ближайший ВИДИМЫЙ предок (null у детей корня). */
export interface ForkNode {
  id: string
  slug: string
  title: LocaleText
  handle: string
  starsCount: number
  updatedAt: Date
  /**
   * Активная ветвь — правленная недавно. Считается ЗДЕСЬ, потому что это чтение часов:
   * в рендере оно нечистое, и соседние строки сравнивались бы с разными «сейчас»
   * (forks/011). Страница получает готовое значение и часы не трогает.
   */
  fresh: boolean
  parentId: string | null
  children: ForkNode[]
}

export interface ForkTree {
  /** Дети корня, каждый со своим поддеревом. */
  roots: ForkNode[]
  /** Сколько видимых форков попало в дерево. */
  count: number
  /** Что не поместилось в границы обхода — страница обязана это показать. */
  truncated: { depth: boolean; width: boolean; nodes: boolean }
}

/**
 * Границы обхода — настройками, а не числами в коде: дерево растёт вместе с корпусом, и
 * подкручивать их придётся по факту, а не по догадке. Дефолты выбраны так, чтобы обычное
 * дерево (десятки форков, две-три ступени) помещалось целиком.
 */
const maxDepth = () => envNumber('SETFORK_FORK_TREE_MAX_DEPTH', 6)
const maxChildren = () => envNumber('SETFORK_FORK_TREE_MAX_CHILDREN', 50)
const maxNodes = () => envNumber('SETFORK_FORK_TREE_MAX_NODES', 200)

/** «Активная ветвь» — правка за последнюю неделю (прежнее правило страницы). */
const FRESH_WINDOW_MS = 7 * 24 * 60 * 60 * 1000

interface Row {
  id: string
  slug: string
  title: LocaleText
  handle: string
  stars_count: number
  updated_at: string | Date
  parent_id: string | null
  depth: number
  visible: boolean
  truncated_children: boolean
}

export async function getForkTree(rootId: string): Promise<ForkTree> {
  const depthLimit = maxDepth()
  const widthLimit = maxChildren()
  const nodeLimit = maxNodes()
  // Правило видимости — каноническое (`publiclyVisible`), а не переписанное литералами:
  // копии этого условия уже расходились с оригиналом, и цена промаха здесь — чужое
  // содержимое наружу (forks/009). Оно ссылается на таблицу под её собственным именем,
  // поэтому подзапросы ниже её не переименовывают.
  const res = await db.execute(sql`
    WITH RECURSIVE tree AS (
      SELECT
        c.id, c.slug, c.title, c.owner_id, c.stars_count, c.updated_at,
        NULL::uuid AS visible_parent,
        1 AS raw_depth,
        c.visible,
        c.child_count > ${widthLimit} AS truncated_children
      FROM (
        SELECT ${templates}.*, (${publiclyVisible()}) AS visible, count(*) OVER () AS child_count
        FROM ${templates}
        WHERE ${templates}.forked_from_id = ${rootId}
        ORDER BY ${templates}.updated_at DESC
        LIMIT ${widthLimit}
      ) AS c
      UNION ALL
      SELECT
        c.id, c.slug, c.title, c.owner_id, c.stars_count, c.updated_at,
        -- Ближайший ВИДИМЫЙ предок: скрытый узел прозрачен для родословной.
        CASE WHEN tree.visible THEN tree.id ELSE tree.visible_parent END,
        tree.raw_depth + 1,
        c.visible,
        c.child_count > ${widthLimit} AS truncated_children
      FROM tree
      JOIN LATERAL (
        SELECT ${templates}.*, (${publiclyVisible()}) AS visible, count(*) OVER () AS child_count
        FROM ${templates}
        WHERE ${templates}.forked_from_id = tree.id
        ORDER BY ${templates}.updated_at DESC
        LIMIT ${widthLimit}
      ) AS c ON true
      WHERE tree.raw_depth < ${depthLimit}
    ) CYCLE id SET is_cycle USING path
    SELECT tree.id, tree.slug, tree.title, u.handle, tree.stars_count, tree.updated_at,
           tree.visible_parent AS parent_id, tree.raw_depth AS depth, tree.visible,
           tree.truncated_children
    FROM tree
    JOIN users u ON u.id = tree.owner_id
    WHERE NOT tree.is_cycle
    ORDER BY tree.raw_depth, tree.updated_at DESC
    LIMIT ${nodeLimit + 1}
  `)

  const rows = res.rows as unknown as Row[]
  const overflow = rows.length > nodeLimit
  const kept = overflow ? rows.slice(0, nodeLimit) : rows
  return buildForest(kept, {
    depth: kept.some((r) => r.depth >= depthLimit),
    width: kept.some((r) => r.truncated_children),
    nodes: overflow,
  })
}

/**
 * Строки → лес. Невидимые узлы в дерево не попадают: они нужны были только чтобы обход
 * прошёл сквозь них, а их потомки уже несут ссылку на ближайшего видимого предка.
 *
 * Родитель может не попасть в выборку (обрезан потолком узлов) — тогда его потомок
 * поднимается в корень, а не исчезает: неполное дерево лучше пустого места, и усечение
 * всё равно объявлено флагом.
 */
function buildForest(rows: Row[], truncated: ForkTree['truncated']): ForkTree {
  const visible = rows.filter((r) => r.visible)
  const nodes = new Map<string, ForkNode>()
  // Одно чтение часов на всё дерево: иначе соседние узлы сравниваются с разными «сейчас».
  const now = Date.now()
  for (const r of visible) {
    const updatedAt = new Date(r.updated_at)
    nodes.set(r.id, {
      id: r.id,
      slug: r.slug,
      title: r.title,
      handle: r.handle,
      starsCount: r.stars_count,
      updatedAt,
      fresh: now - updatedAt.getTime() < FRESH_WINDOW_MS,
      parentId: r.parent_id,
      children: [],
    })
  }
  const roots: ForkNode[] = []
  for (const r of visible) {
    const node = nodes.get(r.id)!
    const parent = r.parent_id ? nodes.get(r.parent_id) : undefined
    if (parent) parent.children.push(node)
    else {
      node.parentId = null
      roots.push(node)
    }
  }
  return { roots, count: visible.length, truncated }
}
