import 'server-only'
import { and, eq, gte, sql } from 'drizzle-orm'
import type { Lang } from '@/shared/i18n'
import { aiUsage, db, generationCandidates, users, type CandidateItem } from '@/shared/db'
import { generateListDraft, sanitizeCommand, type GenerateOptions, type GeneratedList } from '@/shared/ai/generate'
import { generateListCouncil } from '@/shared/ai/council'
import { setClarify } from '@/shared/ai/council-clarify'
import { clearCouncilEvents } from '@/shared/ai/council-progress'
import { recordUsage } from '@/shared/ai/usage'
import { getAiSettings } from '@/shared/settings/ai'
import { isAdminHandle } from '@/shared/auth/admin-handle'
import { parseTags } from '@/features/library/slug'

/** Админ ли пользователь (по handle из ADMIN_HANDLES) — для гейта аудитории совета. */
async function isAdminUser(userId: string): Promise<boolean> {
  try {
    const [u] = await db.select({ handle: users.handle }).from(users).where(eq(users.id, userId)).limit(1)
    return isAdminHandle(u?.handle ?? null)
  } catch {
    return false
  }
}

// Лимит совета считаем по ДОСТАВЛЕННЫМ советам за месяц (маркер 'council-run'), а не по попыткам:
// clarify/фолбэк/ошибка слот не жгут. Маркер пишется только при реально отданном списке.
async function councilRunsThisMonth(userId: string): Promise<number> {
  const [r] = await db
    .select({ n: sql<number>`count(distinct ${aiUsage.refId})::int` })
    .from(aiUsage)
    .where(and(eq(aiUsage.userId, userId), eq(aiUsage.refType, 'council-run'), gte(aiUsage.createdAt, sql`date_trunc('month', now())`)))
  return r?.n ?? 0
}
function recordCouncilRun(userId: string, generationId: string): Promise<void> {
  return recordUsage({ userId, feature: 'generate', model: 'council', input: 0, output: 0, total: 0, cost: 0, refType: 'council-run', refId: generationId })
}

/**
 * Сгенерировать один вариант и сохранить кандидатом (idx). Возвращает false при ошибке ИИ.
 * Вынесено из actions.ts, чтобы вызывать из фонового воркера очереди (job 'generate').
 */
export async function addCandidate(
  generationId: string,
  userId: string,
  query: string,
  lang: Lang,
  idx: number,
): Promise<boolean> {
  // Лента театра — ПЕР-ПОПЫТКА: чистим на старте, иначе события копятся по generationId и в ленте
  // мешаются прошлые прогоны («Ещё вариант»/ретрай джобы) — отсюда были дубли вроде «тема простая» ×2.
  await clearCouncilEvents(generationId)
  const genOpts: GenerateOptions = {
    web: true,
    variant: idx,
    userId,
    feature: idx > 1 ? 'regenerate' : 'generate',
    refType: 'generation',
    refId: generationId,
  }
  // «Совет» (за флагом + гейт аудитории). Дорогие проверки (settings-admin / лимит) — ТОЛЬКО когда фича включена.
  const settings = await getAiSettings()
  let useCouncil = false
  if (settings.councilEnabled) {
    const admin = await isAdminUser(userId)
    useCouncil = settings.councilAudience === 'all' || admin
    // Лимит (не для админов): по ДОСТАВЛЕННЫМ советам за месяц; исчерпал → одиночная генерация.
    if (useCouncil && !admin && settings.councilMaxPerMonth > 0 && (await councilRunsThisMonth(userId)) >= settings.councilMaxPerMonth) {
      useCouncil = false
    }
  }

  let draft: GeneratedList | null = null
  if (useCouncil) {
    // #6: под-вызовы совета помечаем refType 'council' — админ-«Расход» отличает их от одиночных.
    const res = await generateListCouncil(query, lang, { ...genOpts, refType: 'council' })
    if (res && 'clarify' in res) {
      // Диалог только на ПЕРВИЧНОЙ генерации: показываем форму (кандидата нет, ждём ответов).
      // На «ещё вариант» (idx>1) clarify игнорируем — иначе пустой экран/коллизия idx=1; падаем на одиночную.
      if (idx === 1) {
        await setClarify(generationId, res.clarify)
        return true
      }
    } else {
      draft = res
    }
    // #4: слот лимита дебетуем ТОЛЬКО при реально отданном списке (не clarify/фолбэк/ошибка).
    if (draft) await recordCouncilRun(userId, generationId)
  }
  draft = draft ?? (await generateListDraft(query, lang, genOpts))
  if (!draft) return false
  const items: CandidateItem[] = draft.items.map((it) => ({
    title: it.title,
    desc: it.desc,
    command: sanitizeCommand(it.command ?? ''),
    level: it.level,
    why: it.why,
    subtasks: it.subtasks,
    refs: it.refs,
  }))
  await db.insert(generationCandidates).values({
    generationId,
    idx,
    title: (draft.title || query).slice(0, 140),
    desc: draft.desc ?? '',
    tags: draft.tags.length ? parseTags(draft.tags.join(' ')) : parseTags(query),
    items,
  })
  return true
}
