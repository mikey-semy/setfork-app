import 'server-only'
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm'
import { db, knowledgeSources, listDrafts, runs, runStepState, steps, suggestionReportedChecks, suggestions, templates, templateVersions, users, type ProposedItem } from '@/shared/db'
import { tr, trKey, type LocaleText } from '@/shared/i18n'
// eslint-disable-next-line no-restricted-imports -- MCP: доступ по userId токена (нет cookie-сессии/админа), canViewList на месте у каждого вызова
import { getFeed, getTemplateDetail } from '@/features/library/queries'
import { canEditList, canViewList, ListWriteError } from '@/core'
import { assertNoDestructiveSteps, DestructiveCommandError, findRisky } from '@/core/domain/destructive-command'
import { listQuota } from '@/shared/quota'
import { detectTextLang } from '@/shared/lib/translit'
import { buildScript, dialectExt, normalizeDialect, toExportList } from '@/features/library/export'
import { listStore } from '@/features/library/list-store'
import { applySuggestion, createSuggestion, mergeSuggestion, reviewSuggestion, revertSuggestion } from '@/features/library/suggestion-core'
import { slugify, uniqueSlug } from '@/features/library/slug'
import { recordAgentAction } from '@/shared/agents/policy'
import { findExistingNearDuplicate } from '@/shared/ai/near-dup-check'
import { attributionLine, checkLicense } from '@/shared/ai/source-license'
import { emptyBlock, toProposedItems, type EditorItem } from '@/features/library/editor'
import { isBlockType, newOptionId } from '@/features/library/blocks'
import { applyPatchOps, patchFields, type McpPatchOp } from '../patch'
import { deleteDraft, publishDraftFor } from '@/features/library/draft'
import { getDraft } from '@/features/library/queries'
// Единый конвертер шагов на запись — тот же, что у веба, садовника и предложений.
// Своя копия в MCP теряла blockId и «здесь нужен человек» (см. комментарий в модуле).
import { toStepInput as stepInput } from '@/shared/lib/step-input'
import { isCollaborator } from '@/features/collab/queries'
import { isAdminHandle } from '@/shared/auth/admin-handle'
import { recordAudit } from '@/shared/audit'
import { REPORTED_STATUSES, reportedChecks, type ReportedStatus } from '@/features/library/suggestion-checks'
import { currentRevision } from '@/features/library/suggestion-core'
import { recordRunCompletionIfDone } from '@/shared/completion'
import { getCourseCompletion } from '@/features/quizzes/queries'
import { mcpCanView } from './shared'
import { SITE_URL, toProposed, type McpItemInput } from './shared'
import { blockForMcp, type DetailStep } from './shared'



// Прямая перезапись шагов версии (для in-place правки черновика; порт addVersion создаёт НОВУЮ).
// Удаление и вставка — ОДНОЙ транзакцией: они и раньше шли парой, но по отдельности,
// и любой сбой вставки (мусорное значение из внешнего вызова, обрыв связи) оставлял
// черновик БЕЗ шагов — то есть терял работу владельца целиком.
// TODO(rust-boundary): вынести в порт (ListStore.replaceDraftSteps) при следующем проходе.
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

async function replaceDraftStepsIn(tx: Tx, versionId: string, items: ProposedItem[]): Promise<void> {
  if (!items.length) return
  // Форму строк берём у ОБЩЕГО конвертера (stepInput): своя копия здесь молча
  // теряла blockId и «здесь нужен человек» — а с ними комментарии к пункту,
  // merge по идентичности и приглашение ответить из опыта.
  const rows = stepInput(items)
  // Страж разрушительных команд стоит в фасаде listStore, но ПРЯМАЯ правка
  // черновика идёт мимо него: без этой проверки через API можно было положить
  // `rm -rf /` в черновик, а get_script отдал бы его готовым скриптом.
  assertNoDestructiveSteps(rows)

  const cols = (it: (typeof rows)[number]) => ({
    n: it.n,
    type: it.type,
    content: it.content,
    blockId: it.blockId,
    title: it.title,
    desc: it.desc,
    command: it.command,
    hasImage: !!it.imageRef,
    imageKey: it.imageRef,
    level: it.level,
    why: it.why,
    needsHuman: it.needsHuman,
    needsHumanAsk: it.needsHumanAsk,
    section: it.section,
    subtasks: it.subtasks,
    refs: it.refs,
  })

  // Строки СВЕРЯЕМ по идентичности блока, а не сносим все разом. steps.id —
  // якорь состояния активного прогона (run_step_state.step_id, ON DELETE CASCADE):
  // полная перезапись стирала отметки, заметки и подпункты у идущего прогона, а
  // сам прогон оставался активным — со ссылками на строки, которых больше нет.
  const existing = await tx.select({ id: steps.id, blockId: steps.blockId }).from(steps).where(eq(steps.versionId, versionId))
  const byBlock = new Map(existing.flatMap((r) => (r.blockId ? [[r.blockId, r.id] as const] : [])))
  const kept = new Set<string>()
  const addedStepIds: string[] = []
  // Запросы идут ПОСЛЕДОВАТЕЛЬНО намеренно: это одна транзакция на одном
  // соединении, параллелить её операции нельзя (Promise.all их только перемешает).
  for (const it of rows) {
    const id = it.blockId ? byBlock.get(it.blockId) : undefined
    if (id) {
      await tx.update(steps).set(cols(it)).where(eq(steps.id, id))
      kept.add(id)
    } else {
      const [row] = await tx.insert(steps).values({ versionId, ...cols(it) }).returning({ id: steps.id, type: steps.type })
      if (row.type === 'step') addedStepIds.push(row.id)
    }
  }
  const gone = existing.flatMap((r) => (kept.has(r.id) ? [] : [r.id]))
  if (gone.length) await tx.delete(steps).where(inArray(steps.id, gone))

  // Новый шаг-блок в версии, по которой УЖЕ идёт прогон, обязан получить строку
  // состояния: её заводят разом при старте прогона, и без неё отметка нового шага
  // молча не срабатывает — ни в вебе (toggleStep выходит), ни через API.
  if (addedStepIds.length) {
    const active = await tx.select({ id: runs.id }).from(runs).where(and(eq(runs.versionId, versionId), eq(runs.status, 'active')))
    if (active.length)
      await tx.insert(runStepState).values(active.flatMap((r) => addedStepIds.map((stepId) => ({ runId: r.id, stepId }))))
  }
}

/** Два блока с одним bid: reconcile попадёт в одну строку дважды, и один блок
 *  молча исчезнет. У патча дубли отбивает applyPatchOps, но полная замена идёт
 *  мимо него — проверяем состав перед записью на обоих путях. */
function duplicateBid(items: ProposedItem[]): string | null {
  const seen = new Set<string>()
  for (const it of items) {
    const id = it.blockId
    if (!id) continue
    if (seen.has(id)) return id
    seen.add(id)
  }
  return null
}

async function replaceDraftSteps(versionId: string, items: ProposedItem[]): Promise<void> {
  if (!items.length) return
  await db.transaction((tx) => replaceDraftStepsIn(tx, versionId, items))
}

/** Замок на список внутри транзакции. Патч черновика читает блоки и пишет их
 *  под ним: у черновика номер версии не растёт, поэтому сверять «правка основана
 *  на текущей версии» там нечем — второй патч с тем же baseVersion прошёл бы
 *  проверку и затёр первый. С замком конкурент ждёт и читает УЖЕ новое состояние
 *  (для опубликованных ту же роль играет expected_version в ядре). */
const lockList = (tx: Tx, listId: string) =>
  tx.execute(sql`select id from ${templates} where ${templates.id} = ${listId} for update`)

/** Состояние списка ПОД ЗАМКОМ: пока правку готовили, его могли опубликовать,
 *  заморозить или заархивировать. Прямая правка черновика идёт мимо фасада
 *  listStore, который стережёт эти запреты у опубликованного пути, — значит
 *  проверяем сами и на свежих данных, а не на прочитанных до замка. */
async function draftWritable(tx: Tx, listId: string): Promise<{ error: string } | null> {
  const [row] = await tx
    .select({ status: templates.status, archivedAt: templates.archivedAt, frozenAt: templates.frozenAt })
    .from(templates)
    .where(eq(templates.id, listId))
  if (!row) return { error: 'list not found' }
  if (!canEditList(row)) return { error: 'forbidden: list is archived or frozen' }
  if (row.status !== 'draft')
    return { error: 'the list was published while the edit was being prepared — read it again (get_list) and write to the published version' }
  return null
}

// Инструменты MCP работают от имени пользователя токена (userId).
// Приватность соблюдается: getFeed/visibleFilter уже фильтруют по viewerId,
// get_list проверяет доступ явно. Контент отдаём в EN (locale-JSON, tr с фолбэком).

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
  const title = input.title?.trim()
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
    desc: input.desc?.trim() ? { [lang]: input.desc.trim() } : {},
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

/** Строки версии → доменные блоки БЕЗ потерь: locale-JSON, content и идентичность
 *  как есть. Этим путём патч ведёт НЕТРОНУТЫЕ блоки: плоская MCP-форма отдаёт по
 *  одной строке на поле (переводы схлопнулись бы) и не знает про товары. */
function rowsToProposed(rows: DetailStep[]): ProposedItem[] {
  return rows.map(
    (s) =>
      ({
        blockId: s.blockId ?? undefined,
        type: s.type ?? 'step',
        content: (s.content ?? {}) as Record<string, unknown>,
        title: s.title,
        desc: s.desc,
        command: s.command,
        hasImage: s.hasImage,
        imageKey: s.imageKey ?? undefined,
        level: s.level,
        why: s.why,
        section: s.section,
        needsHuman: s.needsHuman,
        needsHumanAsk: s.needsHumanAsk,
        subtasks: s.subtasks,
        refs: s.refs,
      }) as unknown as ProposedItem,
  )
}

/** Локализованные поля блока: их правка обязана дописываться В ЯЗЫК, а не поверх
 *  всего словаря — иначе патч по-английски стирает русский текст списка. */
const LOCALIZED = ['title', 'desc', 'why', 'section', 'needsHumanAsk'] as const

/** Поле входа MCP → ключ в content не-step блока. Нужен, чтобы отличить «поле не
 *  трогали» от «поле явно очистили»: сериализатор пустое и false опускает, и без
 *  этой карты очистка молча не применялась бы. */
const CONTENT_KEY: Record<string, string | undefined> = {
  text: 'md',
  ref: 'ref',
  imageRef: 'ref',
  url: 'url',
  name: 'name',
  fileName: 'name',
  caption: 'caption',
  question: 'question',
  options: 'options',
  multi: 'multi',
  deadline: 'deadline',
  explain: 'explain',
  quizKind: 'kind',
  accept: 'accept',
  caseSensitive: 'caseSensitive',
  answer: 'answer',
  tolerance: 'tolerance',
  template: 'template',
  blanks: 'blanks',
  pairs: 'pairs',
  sortItems: 'items',
}

/** Ключ локали, В КОТОРЫЙ ложится правка. Это ровно тот ключ, ОТКУДА чтение взяло
 *  показанное агенту значение (trKey повторяет выбор tr): у списка с двумя
 *  переводами `{ ru: 'старое', en: 'old' }` get_list отдаёт английский, и правка
 *  обязана лечь в en. Иначе она обновит русский, а наружу продолжит отдаваться
 *  прежний английский — правка выглядит принятой, но не видна. */
const langOfField = (lt: unknown): string => trKey(lt as LocaleText, 'en') ?? 'en'
const putLang = (before: unknown, flat: string): Record<string, string> => {
  const base = { ...((before ?? {}) as Record<string, string>) }
  const key = langOfField(before)
  // Очистка убирает ТОЛЬКО ту локаль, которую агент видел и стёр. Прежде она
  // сносила словарь целиком — правка «убрать описание» по-английски уносила с
  // собой и русское описание, которого агент даже не видел.
  if (flat.trim()) base[key] = flat.trim()
  else delete base[key]
  return base
}

/**
 * Наложить операцию update на существующий блок.
 *
 * Плоскую форму проходит ТОЛЬКО этот блок, и только ради полей, которые агент
 * действительно прислал: остальное берётся у прежнего блока как есть. Поэтому
 * перевод, картинка и содержимое непереданных полей переживают патч.
 */
function patchBlock(item: ProposedItem, op: McpPatchOp): ProposedItem | { error: string } {
  const fields = patchFields(op)
  if (!Object.keys(fields).length) return { error: 'nothing to update — pass at least one field' }
  const type = item.type ?? 'step'
  // Товары через MCP пока не представлены (нет ни в чтении, ни во входе). Честный
  // отказ вместо тихого превращения подборки в пустой шаг.
  if (type === 'product') return { error: 'product blocks cannot be patched through the API yet' }
  if (fields.type && fields.type !== type) return { error: `cannot change block type (${type} → ${fields.type}); delete and insert instead` }

  const flatBefore = { ...blockForMcp(item as unknown as DetailStep), section: tr(item.section as LocaleText, 'en') || undefined }
  const [built] = toProposed([{ ...flatBefore, ...fields, type }])
  if (!built) return { error: 'the patch would leave the block empty (a step needs a title)' }

  const out = { ...built, blockId: item.blockId } as unknown as Record<string, unknown>
  // Снятая пометка «нужен человек» уносит и вопрос: иначе get_list продолжал бы
  // отдавать вопрос при снятой пометке, а повторное включение воскрешало старый.
  const clears = new Set<string>(Object.keys(fields))
  if (fields.needsHuman === false) clears.add('needsHumanAsk')
  for (const f of LOCALIZED) {
    out[f] = clears.has(f) ? putLang(item[f], tr(built[f] as LocaleText, 'en')) : item[f]
  }
  // Списки локализованных значений сопоставляем по ПОКАЗАННОМУ тексту, а не по
  // позиции: вставка в начало сдвигала бы переводы на соседние пункты — русский
  // текст оказывался у чужой проверки. Совпал текст — элемент тот же, словарь
  // переносим целиком; не совпал — это новое значение, пишем в язык блока.
  const blockLang = langOfField(item.title)
  const pickLocales = (oldList: LocaleText[], flat: string): LocaleText => {
    const same = oldList.find((o) => tr(o, 'en') === flat)
    return same ?? ({ [blockLang]: flat } as LocaleText)
  }
  const oldSubs = (item.subtasks ?? []) as LocaleText[]
  out.subtasks = 'subtasks' in fields ? (built.subtasks ?? []).map((s) => pickLocales(oldSubs, tr(s as LocaleText, 'en'))) : oldSubs
  const oldRefs = (item.refs ?? []) as { label: LocaleText; url?: string }[]
  out.refs =
    'refs' in fields
      ? (built.refs ?? []).map((r) => ({
          label: pickLocales(oldRefs.map((x) => x.label), tr(r.label as LocaleText, 'en')),
          ...(r.url ? { url: r.url } : {}),
        }))
      : oldRefs
  // Ключи content, которых плоская форма не знает, сохраняем: иначе патч соседнего
  // поля вычищал бы всё, что MCP пока не умеет представлять (например товары).
  const oldContent = (item.content ?? {}) as Record<string, unknown>
  const newContent = (built.content ?? {}) as Record<string, unknown>
  const content: Record<string, unknown> = { ...oldContent, ...newContent }
  // …но ЯВНАЯ очистка обязана срабатывать. Сериализатор опускает пустое и false
  // (multi: false, пустой deadline/caption/explain) — при простом слиянии поверх
  // старого значения такая правка не делала бы ничего, а ответ был бы успешным.
  for (const field of Object.keys(fields)) {
    const key = CONTENT_KEY[field]
    if (key && !(key in newContent)) delete content[key]
  }
  out.content = content
  return out as unknown as ProposedItem
}

/** Отказ стража разрушительных команд → ответ инструмента. Это не сбой, а
 *  вердикт: агенту нужно назвать причину, а не увидеть стектрейс. */
const destructiveError = (e: unknown): { error: string } | null =>
  e instanceof DestructiveCommandError
    ? { error: `refused: step ${e.stepIndex} has a destructive command (${e.reason}): ${e.fragment}` }
    : null

/** Список во владении пользователя (для записи) + его версии. */
async function ownedList(userId: string, handle: string, slug: string) {
  const owner = await db.select({ id: users.id }).from(users).where(eq(users.handle, handle)).limit(1)
  if (!owner[0]) return { error: 'list not found' as const }
  const tpl = await db.query.templates.findFirst({
    where: (t) => and(eq(t.ownerId, owner[0].id), eq(t.slug, slug)),
    with: { versions: { orderBy: (v, { desc: d }) => d(v.version) } },
  })
  if (!tpl) return { error: 'list not found' as const }
  if (tpl.ownerId !== userId) return { error: 'forbidden: you are not the owner' as const }
  // Архив/заморозка: гейт нужен ЗДЕСЬ, а не только в фасадном бэкстопе addVersion —
  // мета (tags/ordered) обновляется до версии и не должна утечь в read-only список.
  if (!canEditList(tpl)) return { error: 'forbidden: list is archived or frozen' as const }
  return { tpl }
}

/** Записать НОВЫЙ состав блоков (доменная форма): черновик правится на месте,
 *  опубликованный получает новую версию. Общая половина update_list и patch_list —
 *  писать список двумя разными путями значит рано или поздно расхождение. */
async function writeProposed(
  tpl: NonNullable<Awaited<ReturnType<typeof ownedList>>['tpl']>,
  handle: string,
  slug: string,
  proposed: ProposedItem[],
  note: string,
  meta: { tags: string[]; ordered: boolean },
  expectedVersion?: number,
) {
  if (!proposed.length) return { error: 'at least one item with a title is required' }
  const dup = duplicateBid(proposed)
  if (dup) return { error: `two blocks share the same bid "${dup}" — a block id must be unique within a list` }

  if (tpl.status === 'draft') {
    // черновик — перезаписываем текущую версию на месте (без плодения версий).
    // ПОД ТЕМ ЖЕ замком, что и патч: иначе полная замена и патч переплетаются —
    // замена удаляет и вставляет строки, пока патч держит только замок списка, и
    // чья-то работа пропадает при обоих «успешных» ответах.
    const cur = tpl.versions.find((v) => v.version === tpl.currentVersion) ?? tpl.versions[0]
    try {
      const gate = await db.transaction(async (tx) => {
        await lockList(tx, tpl.id)
        const denied = await draftWritable(tx, tpl.id)
        if (denied) return denied
        await replaceDraftStepsIn(tx, cur.id, proposed)
        await tx.update(templates).set({ tags: meta.tags, ordered: meta.ordered, updatedAt: new Date() }).where(eq(templates.id, tpl.id))
        return null
      })
      if (gate) return gate
    } catch (e) {
      const refused = destructiveError(e)
      if (refused) return refused
      throw e
    }
    return { ref: `${handle}/${slug}`, status: 'draft', version: cur.version }
  }

  // tags/ordered едут ВНУТРИ addVersion (Ф2a-довесок): ядро применяет мету той же
  // транзакцией, что и версию, — канон коммита сразу несёт свежие значения.
  // expectedVersion (если задан) ядро сверяет ТАМ ЖЕ: сравнение и запись под одним
  // замком строки, иначе между ними успевает лечь чужая версия.
  let ver
  try {
    ver = await listStore.addVersion(tpl.id, { note, steps: stepInput(proposed), meta, expectedVersion })
  } catch (e) {
    // Отказ ядра по устаревшей версии — не сбой, а нормальный исход гонки: пока
    // правку готовили, список ушёл вперёд. Агент перечитывает и накладывает заново.
    if (e instanceof ListWriteError && e.code === 'stale')
      return { error: 'list changed while the patch was being applied — read it again (get_list) and rebuild the ops' }
    throw e
  }
  // Пере-проверку публичного списка делает фасад listStore.addVersion (барьер): нарушающий
  // контент, залитый через MCP, не минует модерацию, и здесь её дублировать не нужно.
  const { enqueueReindex } = await import('@/features/library/jobs')
  await enqueueReindex(tpl.id)
  return { ref: `${handle}/${slug}`, status: 'published', version: ver.version }
}

/** Обновить список (только владелец). Черновик — правим на месте; опубликованный — новая версия. */
export interface McpUpdateInput {
  items: McpItemInput[]
  note?: string
  tags?: string[]
  ordered?: boolean
}

/** Удалить свой список целиком. Пробный черновик, созданный агентом, раньше можно
 *  было убрать только руками в интерфейсе (жалоба владельца 04.08.2026: после пробы
 *  остался мусорный черновик, а API его не удаляет).
 *
 *  Удаление НЕОБРАТИМО (каскадом уходят версии, шаги, звёзды, предложения), поэтому
 *  оно требует явного confirm — тем же приёмом, что сухой прогон у bulk_create_lists.
 *  Снятый модерацией список владелец удалить не может: hard-delete стёр бы его
 *  contentFingerprint, то есть защиту от повторной заливки того же контента. */
export async function mcpDeleteList(userId: string, handle: string, slug: string, confirm: boolean) {
  const owner = await db.select({ id: users.id }).from(users).where(eq(users.handle, handle)).limit(1)
  if (!owner[0]) return { error: 'list not found' as const }
  const tpl = await db.query.templates.findFirst({ where: (t) => and(eq(t.ownerId, owner[0].id), eq(t.slug, slug)) })
  if (!tpl) return { error: 'list not found' as const }
  if (tpl.ownerId !== userId) return { error: 'forbidden: you are not the owner' as const }

  const me = await db.select({ handle: users.handle }).from(users).where(eq(users.id, userId)).limit(1)
  if ((tpl.moderation === 'flagged' || tpl.moderation === 'hidden') && !isAdminHandle(me[0]?.handle ?? null)) {
    return { error: 'forbidden: list is locked by moderation — appeal instead of deleting' as const }
  }
  if (!confirm) {
    return {
      ref: `${handle}/${slug}`,
      deleted: false,
      title: tr(tpl.title, 'en'),
      status: tpl.status,
      version: tpl.currentVersion,
      hint: 'nothing was deleted — call again with confirm:true to delete this list for good (versions, steps, stars and suggested edits go with it)',
    }
  }
  await db.delete(templates).where(eq(templates.id, tpl.id)) // каскад: версии/шаги/звёзды/предложения
  await recordAudit('list.delete', { actorId: userId, targetType: 'list', targetId: tpl.id, meta: { slug: tpl.slug, via: 'mcp' } })
  return { ref: `${handle}/${slug}`, deleted: true }
}

export async function mcpUpdateList(userId: string, handle: string, slug: string, input: McpUpdateInput) {
  const found = await ownedList(userId, handle, slug)
  if ('error' in found) return found
  const { tpl } = found
  const tags = input.tags
    ? input.tags.map((t) => t.toLowerCase().replace(/[^a-z0-9а-яё-]/gi, '')).filter(Boolean).slice(0, 8)
    : tpl.tags
  return writeProposed(tpl, handle, slug, toProposed(input.items ?? []), input.note?.trim() || 'updated via API', {
    tags,
    ordered: input.ordered ?? tpl.ordered,
  })
}

/**
 * Точечная правка: операции над блоками по стабильному bid вместо перезаписи
 * всего списка. Агент шлёт только дельту, состав блоков сервер берёт сам —
 * поэтому непатченные блоки не могут пострадать от неполного тела запроса.
 *
 * baseVersion обязателен (решение владельца; так же устроены sha в GitHub
 * contents API и requiredRevisionId в Google Docs): правка применяется только к
 * той версии, которую агент читал. Иначе он затирал бы правку, сделанную в вебе
 * секундой раньше, даже не заметив её.
 *
 * Потерянных обновлений нет ни на одном из двух путей записи, но защищают их
 * РАЗНЫЕ механизмы: у опубликованного — expected_version в ядре, у черновика (где
 * номер версии не растёт и сверять нечем) — замок строки списка, под которым идут
 * и чтение блоков, и их замена.
 */
export async function mcpPatchList(
  userId: string,
  handle: string,
  slug: string,
  input: { baseVersion: number; ops: McpPatchOp[]; note?: string; publish?: boolean },
) {
  const found = await ownedList(userId, handle, slug)
  if ('error' in found) return found
  const { tpl } = found
  const ops = input.ops ?? []

  // Нетронутые блоки идут в запись СВОЕЙ, доменной формой: со всеми переводами и
  // содержимым как есть. Через плоскую MCP-форму проходит только патчимый блок —
  // иначе правка одного заголовка стирала бы переводы и товары у всего списка.
  // Список, который НИКОГДА не публиковался, правится на месте и версий не плодит —
  // копить ему нечего, а молча проигнорировать publish:false нельзя: агент решил бы,
  // что правки лежат в черновике, тогда как они уже в живом списке.
  if (tpl.status === 'draft' && input.publish === false) {
    return {
      error:
        'this list was never published: edits apply in place and do not create versions, so publish:false does not apply here — call patch_list without it',
    }
  }

  const patchIO = {
    bidOf: (it: ProposedItem) =>
      it.blockId ?? (typeof (it.content as Record<string, unknown> | undefined)?.bid === 'string' ? (it.content as Record<string, string>).bid : undefined),
    update: patchBlock,
    create: (block: McpItemInput) => toProposed([block])[0] ?? { error: 'the inserted block is empty (a step needs a title)' },
  }

  if (tpl.status === 'draft') {
    // ЧЕРНОВИК: читаем состав и заменяем его ПОД ОДНИМ замком. Конкурирующий патч
    // ждёт на нём и потом читает уже новое состояние — вместо того чтобы наложить
    // свои операции на снимок, который к моменту записи устарел.
    try {
      return await db.transaction(async (tx) => {
      await lockList(tx, tpl.id)
      // Состояние ПЕРЕЧИТЫВАЕМ под замком: пока патч готовили, список могли
      // опубликовать, заморозить или заархивировать. Со старыми данными на руках
      // правка заменила бы шаги уже опубликованной версии НА МЕСТЕ — без новой
      // версии и без git-коммита, то есть мимо истории.
      const denied = await draftWritable(tx, tpl.id)
      if (denied) return denied
      const [fresh] = await tx.select({ current: templates.currentVersion }).from(templates).where(eq(templates.id, tpl.id))
      if (!fresh) return { error: 'list not found' }
      if (input.baseVersion !== fresh.current)
        return { error: `list changed: it is at version ${fresh.current}, your patch is based on ${input.baseVersion} — read it again (get_list) and rebuild the ops` }
      const [cur] = await tx
        .select({ id: templateVersions.id, version: templateVersions.version })
        .from(templateVersions)
        .where(and(eq(templateVersions.templateId, tpl.id), eq(templateVersions.version, fresh.current)))
        .limit(1)
      if (!cur) return { error: 'list not found' }

      const rows = await tx.select().from(steps).where(eq(steps.versionId, cur.id)).orderBy(asc(steps.n))
      const applied = applyPatchOps<ProposedItem>(rowsToProposed(rows as unknown as DetailStep[]), ops, patchIO)
      if ('error' in applied) return applied
      if (!applied.items.length) return { error: 'at least one item with a title is required' }
      const dupBid = duplicateBid(applied.items)
      if (dupBid) return { error: `two blocks share the same bid "${dupBid}" — a block id must be unique within a list` }
      await replaceDraftStepsIn(tx, cur.id, applied.items)
        await tx.update(templates).set({ updatedAt: new Date() }).where(eq(templates.id, tpl.id))
        return { ref: `${handle}/${slug}`, status: 'draft', version: cur.version, ops: ops.length, blocks: applied.items.length }
      })
    } catch (e) {
      const refused = destructiveError(e)
      if (refused) return refused
      throw e
    }
  }

  const detail = await getTemplateDetail(handle, slug)
  if (!detail) return { error: 'list not found' }
  const current = detail.currentVersion?.version ?? tpl.currentVersion

  // publish:false — правки НЕ создают версию, а копятся в черновике (том же, что
  // видит редактор). Патч ложится ПОВЕРХ черновика, если он есть: иначе второй
  // вызов затирал бы первый, и «накопить пачку» было бы невозможно. База сверяется
  // с версией, от которой черновик начат, — она и уедет в expectedVersion при
  // публикации.
  if (input.publish === false) {
    // Чтение и запись черновика — ПОД ОДНИМ замком списка. Иначе два патча (или патч
    // и сохранение человеком в редакторе) читают один и тот же состав, а пишут по
    // очереди целиком — и правка первого исчезает, хотя оба получили «успех».
    try {
      return await db.transaction(async (tx) => {
        await lockList(tx, tpl.id)
        const [fresh] = await tx.select({ current: templates.currentVersion }).from(templates).where(eq(templates.id, tpl.id))
        if (!fresh) return { error: 'list not found' }
        const [existing] = await tx
          .select()
          .from(listDrafts)
          .where(and(eq(listDrafts.templateId, tpl.id), eq(listDrafts.authorId, userId)))
          .limit(1)
        // База — та, от которой сделаны НАКОПЛЕННЫЕ правки: патч ложится поверх них.
        const base = existing?.baseVersion ?? fresh.current
        if (input.baseVersion !== base)
          return {
            error: `your patch is based on version ${input.baseVersion}, but the pending edits are based on ${base} — pass baseVersion ${base} (see pendingEdits in get_list), or drop them with discard_draft`,
          }
        const source = existing ? existing.items : rowsToProposed(detail.steps)
        const appliedDraft = applyPatchOps<ProposedItem>(source, ops, patchIO)
        if ('error' in appliedDraft) return appliedDraft
        if (!appliedDraft.items.length) return { error: 'at least one item with a title is required' }
        const dup = duplicateBid(appliedDraft.items)
        if (dup) return { error: `two blocks share the same bid "${dup}" — a block id must be unique within a list` }
        // Страж исполняемого выхода стоит на КАЖДОЙ записи, включая черновик: иначе
        // через API можно положить `rm -rf /` в чужую рабочую копию, и отказ прилетел
        // бы человеку при публикации, на непонятном ему шаге.
        assertNoDestructiveSteps(stepInput(appliedDraft.items))
        await tx
          .insert(listDrafts)
          .values({
            templateId: tpl.id,
            authorId: userId,
            baseVersion: base,
            items: appliedDraft.items,
            // Мету НЕ снимаем: теги, порядок и «курс» меняются без версии, и снимок
            // откатил бы их при публикации к состоянию на момент первого патча.
            meta: existing?.meta ?? {},
            note: input.note?.trim() || existing?.note || '',
          })
          .onConflictDoUpdate({
            target: [listDrafts.templateId, listDrafts.authorId],
            set: { items: appliedDraft.items, note: input.note?.trim() || existing?.note || '', rev: sql`${listDrafts.rev} + 1`, updatedAt: new Date() },
          })
        return {
          ref: `${handle}/${slug}`,
          status: 'pending' as const,
          baseVersion: base,
          ops: ops.length,
          blocks: appliedDraft.items.length,
          hint: `nothing is published yet — call publish_draft to turn these edits into version ${base + 1}, keep patching with publish:false, or drop them with discard_draft`,
        }
      })
    } catch (e) {
      const refused = destructiveError(e)
      if (refused) return refused
      throw e
    }
  }

  if (input.baseVersion !== current)
    return { error: `list changed: it is at version ${current}, your patch is based on ${input.baseVersion} — read it again (get_list) and rebuild the ops` }

  const applied = applyPatchOps<ProposedItem>(rowsToProposed(detail.steps), ops, patchIO)
  if ('error' in applied) return applied

  // Сверка версии выше — ранний отсев: отбить заведомо устаревший патч дешевле, чем
  // собирать состав. Но решает не она: baseVersion уходит в ядро, и настоящая
  // проверка происходит там, внутри транзакции, где строка списка заблокирована.
  const res = await writeProposed(
    tpl,
    handle,
    slug,
    applied.items,
    input.note?.trim() || 'patched via API',
    { tags: tpl.tags, ordered: tpl.ordered },
    input.baseVersion,
  )
  return 'error' in res ? res : { ...res, ops: ops.length, blocks: applied.items.length }
}

/**
 * Опубликовать накопленные правки одной версией (тот же путь, что кнопка в редакторе).
 *
 * ДВУХШАГОВО без confirm: черновик один на человека, и агент делит его с редактором —
 * там могла остаться незаконченная работа. Первый вызов показывает, ЧТО уедет в
 * версию, второй (confirm:true) публикует.
 */
export async function mcpPublishDraft(userId: string, handle: string, slug: string, note?: string, confirm = false) {
  const found = await ownedList(userId, handle, slug)
  if ('error' in found) return found
  const { tpl } = found
  if (tpl.status === 'draft')
    return { error: 'this list was never published: it is edited in place, so there is nothing to publish from a draft — use publish on the list itself' }
  const draft = await getDraft(tpl.id, userId)
  if (!draft) return { error: 'there are no unpublished edits to publish' }
  if (!confirm) {
    return {
      ref: `${handle}/${slug}`,
      published: false,
      baseVersion: draft.baseVersion,
      wouldBeVersion: tpl.currentVersion + 1,
      blocks: draft.items.length,
      note: (note ?? draft.note).trim() || 'edit',
      updatedAt: draft.updatedAt.toISOString(),
      hint: 'nothing published yet — these edits include everything pending on this list (yours and whatever was left in the editor); call again with confirm:true to publish them as one version',
    }
  }
  try {
    const res = await publishDraftFor(tpl, userId, note)
    if ('error' in res) return { error: res.message }
    // Наблюдатели узнают о версии так же, как при сохранении из редактора.
    const { notifyWatchersNewVersion } = await import('@/features/library/suggestion-side-effects')
    await notifyWatchersNewVersion(tpl.id, userId).catch(() => {})
    return { ref: `${handle}/${slug}`, status: 'published' as const, version: res.version, blocks: res.blocks }
  } catch (e) {
    const refused = destructiveError(e)
    if (refused) return refused
    throw e
  }
}

/** Выбросить накопленные правки — выход из тупика, когда черновик устарел. */
export async function mcpDiscardDraft(userId: string, handle: string, slug: string) {
  const found = await ownedList(userId, handle, slug)
  if ('error' in found) return found
  const { tpl } = found
  const draft = await getDraft(tpl.id, userId)
  if (!draft) return { ref: `${handle}/${slug}`, discarded: false, hint: 'there were no pending edits' }
  await deleteDraft(tpl.id, userId)
  return { ref: `${handle}/${slug}`, discarded: true, blocks: draft.items.length, baseVersion: draft.baseVersion }
}
