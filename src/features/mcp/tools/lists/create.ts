// Создание списков через MCP: одиночное и пачкой. Причина измениться у модуля
// одна — правила, по которым новому списку дают появиться: квота, дедуп по
// заголовку и содержимому, язык контента, журнал действий.
//
// Пачка опасна ровно тем, чем полезна, поэтому сухой прогон и дедуп здесь не
// украшение, а условие её существования (см. комментарий у mcpBulkCreate).

import 'server-only'
import { eq } from 'drizzle-orm'
import { db, templates, users } from '@/shared/db'
import { listQuota } from '@/shared/quota'
import { cleanText } from '@/shared/lib/text-input'
import { detectTextLang } from '@/shared/lib/translit'
import { listStore } from '@/features/library/list-store'
import { slugify, uniqueSlug } from '@/features/library/slug'
import { recordAgentAction } from '@/shared/agents/policy'
import { findExistingNearDuplicate } from '@/shared/ai/near-dup-check'
// Единый конвертер шагов на запись — тот же, что у веба, садовника и предложений.
// Своя копия в MCP теряла blockId и «здесь нужен человек» (см. комментарий в модуле).
import { toStepInput as stepInput } from '@/shared/lib/step-input'
import { toProposed, type McpItemInput } from '../shared'

export interface McpCreateInput {
  title: string
  desc?: string
  tags?: string[]
  ordered?: boolean
  items: McpItemInput[]
  /** Язык контента ('ru'|'en'); не задан — детект по заголовку/описанию. */
  lang?: string
}

/** Создать список от имени пользователя. Всегда как ЧЕРНОВИК — публикует потом владелец на сайте. */
export async function mcpCreateList(userId: string, input: McpCreateInput) {
  const title = cleanText(input.title)
  if (!title) return { error: 'title is required' }
  const proposed = toProposed(input.items ?? [])
  if (!proposed.length) return { error: 'at least one item with a title is required' }

  const [u] = await db.select({ handle: users.handle }).from(users).where(eq(users.id, userId))
  // Тот же лимит на число списков, что и в вебе (createTemplate) — MCP-путь его обходил.
  if (!(await listQuota(userId, u?.handle)).ok) return { error: 'list quota reached — delete a list first' }
  const slug = await uniqueSlug(title, userId)
  const tags = (input.tags ?? []).map((t) => t.toLowerCase().replace(/[^a-z0-9а-яё-]/gi, '')).filter(Boolean).slice(0, 8)
  // Локаль заголовка/описания: явный lang из запроса или детект по тексту —
  // раньше всё хардкодилось в {en:} и русский список получал бейдж EN.
  const lang = input.lang === 'ru' || input.lang === 'en' ? input.lang : detectTextLang(`${title} ${input.desc ?? ''}`)

  await listStore.create({
    ownerId: userId,
    slug,
    title: { [lang]: title },
    desc: cleanText(input.desc) ? { [lang]: cleanText(input.desc) } : {},
    tags,
    ordered: input.ordered ?? true,
    visibility: 'public',
    status: 'draft',
    origin: 'authored',
    note: 'created via API',
    steps: stepInput(proposed),
  })

  return {
    ref: `${u.handle}/${slug}`,
    status: 'draft',
    note: 'Created as a private draft — the owner publishes it on the site to make it public.',
  }
}

/**
 * МАССОВОЕ СОЗДАНИЕ — ускоритель ПОД РУКОЙ ЧЕЛОВЕКА, а не автономная петля.
 *
 * Цель компании — наполнить портал; часть фактуры быстрее получить пачкой через ассистента,
 * чем ждать проходов петли. Но пачка опасна ровно тем, чем полезна: одним вызовом можно
 * налить сотню мусорных списков. Поэтому три ограничения, все обязательные:
 *
 *   1. СУХОЙ ПРОГОН по умолчанию: сначала видно, что БУДЕТ создано (слаг, дубль ли),
 *      и только осознанный `dryRun: false` пишет. Ошибиться в сотне списков молча нельзя;
 *   2. ДЕДУП по нормализованному заголовку среди своих списков: повторный вызов после
 *      обрыва не удваивает библиотеку (идемпотентность по смыслу, а не по случайному ключу);
 *   3. КВОТА и ЧЕРНОВИК как в одиночном создании: пачка не обходит лимит и не публикует.
 *
 * Каждая пачка пишется в журнал действий (principal_mode='on_behalf_of'): видно, что это
 * сделал человек через ассистента, а не петля сама.
 */
export const MCP_BULK_MAX = 25

/** Нормализация заголовка для дедупа: регистр/пунктуация/пробелы не считаются различием. */
const titleKey = (t: string) => t.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()

export interface McpBulkResult {
  dryRun: boolean
  planned: number
  created: number
  duplicates: number
  failed: number
  quotaStopped: boolean
  lists: { title: string; ref?: string; slug?: string; status: 'created' | 'would-create' | 'duplicate' | 'error'; reason?: string }[]
}

export async function mcpBulkCreate(userId: string, lists: McpCreateInput[], dryRun = true): Promise<McpBulkResult | { error: string }> {
  const batch = (lists ?? []).filter((l) => l?.title?.trim())
  if (!batch.length) return { error: 'nothing to create: every entry needs a title' }
  if (batch.length > MCP_BULK_MAX) return { error: `too many lists in one call: ${batch.length} > ${MCP_BULK_MAX}` }

  const [u] = await db.select({ handle: users.handle }).from(users).where(eq(users.id, userId))
  const mine = await db.select({ title: templates.title }).from(templates).where(eq(templates.ownerId, userId))
  const seen = new Set(mine.map((r) => titleKey(Object.values((r.title ?? {}) as Record<string, string>).find(Boolean) ?? '')).filter(Boolean))

  const out: McpBulkResult = { dryRun, planned: batch.length, created: 0, duplicates: 0, failed: 0, quotaStopped: false, lists: [] }
  for (const input of batch) {
    const title = input.title.trim()
    const key = titleKey(title)
    if (key && seen.has(key)) {
      out.duplicates++
      out.lists.push({ title, status: 'duplicate', reason: 'you already have a list with this title' })
      continue
    }
    // Квоту проверяем ПЕРЕД каждым списком: пачка не должна пробивать лимит «с разгона».
    if (!(await listQuota(userId, u?.handle)).ok) {
      out.quotaStopped = true
      out.lists.push({ title, status: 'error', reason: 'list quota reached' })
      out.failed++
      break
    }
    // ПОЧТИ-ДУБЛЬ по содержимому, а не по заголовку: пачка — главный способ наплодить
    // клонов («Как испечь хлеб дома» и «Печём хлеб дома своими руками» с теми же шагами).
    // Считается кодом, порог измерен (см. shared/ai/near-duplicate). Проверяем и в сухом
    // прогоне: план обязан говорить правду о том, что будет создано.
    const near = await findExistingNearDuplicate(
      { title, items: (input.items ?? []).map((it) => it.title ?? '').filter(Boolean), tags: input.tags ?? [] },
      { ownerId: userId },
    )
    if (near.match) {
      out.duplicates++
      out.lists.push({ title, status: 'duplicate', reason: `почти дубль «${near.match.title}» (совпадение ${Math.round(near.match.score * 100)}%)` })
      continue
    }
    if (dryRun) {
      seen.add(key)
      out.lists.push({ title, status: 'would-create', slug: slugify(title) })
      continue
    }
    const res = await mcpCreateList(userId, input)
    if ('error' in res) {
      out.failed++
      out.lists.push({ title, status: 'error', reason: res.error as string })
      continue
    }
    seen.add(key)
    out.created++
    out.lists.push({ title, status: 'created', ref: res.ref })
  }

  await recordAgentAction({
    loop: 'mcp',
    action: 'list.bulk',
    resultStatus: out.failed && !out.created ? 'error' : dryRun ? 'dry-run' : 'ok',
    actorUserId: userId,
    principalMode: 'on_behalf_of',
    signal: { planned: out.planned, duplicates: out.duplicates, nearDuplicates: out.lists.filter((l) => l.reason?.startsWith('почти дубль')).length },
    decision: { dryRun, created: out.created, failed: out.failed, quotaStopped: out.quotaStopped },
  })
  return out
}
