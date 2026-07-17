import 'server-only'
import { and, eq, gte, sql } from 'drizzle-orm'
import type { Lang } from '@/shared/i18n'
import { aiUsage, db, generationCandidates, users, type CandidateItem } from '@/shared/db'
import { generateChangeNote, generateListDraft, sanitizeCommand, type GenerateOptions, type GeneratedList } from '@/shared/ai/generate'
import { generateListCouncil } from '@/shared/ai/council'
import { setClarify } from '@/shared/ai/council-clarify'
import { pushMessage, setGenerationStatus } from '@/shared/ai/generation-messages'
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
 * «Что поменялось ключевое» относительно ПРЕДЫДУЩЕГО варианта — одной строкой, для ленты.
 * Переиспользуем generateChangeNote: она ровно про это (примечание к версии из диффа, как
 * git-commit message) — своя функция была бы дублем. Пусто при любой осечке: подпись
 * необязательна, вариант важнее.
 */
async function describeChange(
  generationId: string,
  idx: number,
  items: CandidateItem[],
  lang: Lang,
  opts: GenerateOptions,
): Promise<string> {
  try {
    const [prev] = await db
      .select({ items: generationCandidates.items })
      .from(generationCandidates)
      .where(and(eq(generationCandidates.generationId, generationId), eq(generationCandidates.idx, idx - 1)))
      .limit(1)
    if (!prev) return ''
    return (await generateChangeNote(prev.items, items, lang, { ...opts, feature: 'note' })) ?? ''
  } catch {
    return ''
  }
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
  // Ленту больше НЕ чистим: реплики группируются по витку (attempt = idx), поэтому прошлые прогоны
  // не мешаются — а история придумывания остаётся навсегда, в этом весь смысл беседы.
  await setGenerationStatus(generationId, 'pending')
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
        await setGenerationStatus(generationId, 'clarify')
        return true
      }
    } else {
      draft = res
    }
    // #4: слот лимита дебетуем ТОЛЬКО при реально отданном списке (не clarify/фолбэк/ошибка).
    if (draft) await recordCouncilRun(userId, generationId)
  }
  draft = draft ?? (await generateListDraft(query, lang, genOpts))
  if (!draft) {
    await setGenerationStatus(generationId, 'failed')
    await pushMessage(generationId, { attempt: idx, kind: 'error', text: '', who: 'council' })
    return false
  }
  const items: CandidateItem[] = draft.items.map((it) => ({
    title: it.title,
    desc: it.desc,
    command: sanitizeCommand(it.command ?? ''),
    level: it.level,
    why: it.why,
    subtasks: it.subtasks,
    refs: it.refs,
  }))
  // «Что поменялось ключевое» — только со 2-го витка: у первого сравнивать не с чем.
  const summary = idx > 1 ? await describeChange(generationId, idx, items, lang, genOpts) : ''
  await db.insert(generationCandidates).values({
    generationId,
    idx,
    title: (draft.title || query).slice(0, 140),
    desc: draft.desc ?? '',
    summary,
    tags: draft.tags.length ? parseTags(draft.tags.join(' ')) : parseTags(query),
    items,
  })
  // Реплика-карточка: держит результат на своём месте в ленте времени. Сам список UI берёт по
  // attempt (= idx кандидата) — дублировать его в текст реплики незачем.
  await pushMessage(generationId, { attempt: idx, kind: 'result', text: summary, who: 'elder' })
  await setGenerationStatus(generationId, 'done')
  return true
}
