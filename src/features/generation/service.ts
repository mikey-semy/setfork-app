import 'server-only'
import { eq } from 'drizzle-orm'
import type { Lang } from '@/shared/i18n'
import { db, generationCandidates, users, type CandidateItem } from '@/shared/db'
import { generateListDraft, sanitizeCommand, type GenerateOptions, type GeneratedList } from '@/shared/ai/generate'
import { generateListCouncil } from '@/shared/ai/council'
import { setClarify } from '@/shared/ai/council-clarify'
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
  const genOpts: GenerateOptions = {
    web: true,
    variant: idx,
    userId,
    feature: idx > 1 ? 'regenerate' : 'generate',
    refType: 'generation',
    refId: generationId,
  }
  // «Совет гномов» (за флагом + гейт аудитории) — мультимодельная генерация; при null фолбэк на одиночную.
  const settings = await getAiSettings()
  const useCouncil = settings.councilEnabled && (settings.councilAudience === 'all' || (await isAdminUser(userId)))
  let draft: GeneratedList | null = null
  if (useCouncil) {
    const res = await generateListCouncil(query, lang, genOpts)
    // Диалог: совет попросил уточнений → кладём вопросы, кандидат НЕ создаём (ждём ответов пользователя).
    if (res && 'clarify' in res) {
      setClarify(generationId, res.clarify)
      return true
    }
    draft = res
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
