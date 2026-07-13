import 'server-only'
import type { Lang } from '@/shared/i18n'
import { db, generationCandidates, type CandidateItem } from '@/shared/db'
import { generateListDraft, sanitizeCommand } from '@/shared/ai/generate'
import { parseTags } from '@/features/library/slug'

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
  const draft = await generateListDraft(query, lang, {
    web: true,
    variant: idx,
    userId,
    feature: idx > 1 ? 'regenerate' : 'generate',
    refType: 'generation',
    refId: generationId,
  })
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
