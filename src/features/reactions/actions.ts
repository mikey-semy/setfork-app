'use server'
import { and, eq } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { requireSession } from '@/shared/auth/session'
import { db, issueComments, issues, reactions, suggestionComments, suggestions, templates } from '@/shared/db'
import { canViewList } from '@/core'
import { MAX_EMOJI_LEN, REACTION_TARGETS, type ReactionTarget } from './constants'

// Доступ к списку-владельцу цели (issue/comment/suggestion → его template).
// Заодно проверяет существование цели (null = нет). Реакция на цель приватного
// списка, который зритель не видит, запрещена — как и вся модель видимости.
type ListAccessRow = { ownerId: string; visibility: 'public' | 'private'; status: 'draft' | 'published'; moderation: string }
async function targetListAccess(targetType: ReactionTarget, id: string): Promise<ListAccessRow | null> {
  const cols = { ownerId: templates.ownerId, visibility: templates.visibility, status: templates.status, moderation: templates.moderation }
  let rows: ListAccessRow[] = []
  switch (targetType) {
    case 'issue':
      rows = await db.select(cols).from(issues).innerJoin(templates, eq(issues.templateId, templates.id)).where(eq(issues.id, id)).limit(1)
      break
    case 'issue_comment':
      rows = await db
        .select(cols)
        .from(issueComments)
        .innerJoin(issues, eq(issueComments.issueId, issues.id))
        .innerJoin(templates, eq(issues.templateId, templates.id))
        .where(eq(issueComments.id, id))
        .limit(1)
      break
    case 'suggestion':
      rows = await db.select(cols).from(suggestions).innerJoin(templates, eq(suggestions.templateId, templates.id)).where(eq(suggestions.id, id)).limit(1)
      break
    case 'suggestion_comment':
      rows = await db
        .select(cols)
        .from(suggestionComments)
        .innerJoin(suggestions, eq(suggestionComments.suggestionId, suggestions.id))
        .innerJoin(templates, eq(suggestions.templateId, templates.id))
        .where(eq(suggestionComments.id, id))
        .limit(1)
      break
    default:
      return null
  }
  return rows[0] ?? null
}

/** Тоггл реакции текущего пользователя (эмодзи на цель). Ревалидирует переданный путь. */
export async function toggleReaction(input: {
  targetType: string
  targetId: string
  emoji: string
  path: string
}): Promise<void> {
  const session = await requireSession()
  const { targetType, targetId, path } = input
  const emoji = (input.emoji ?? '').trim()
  if (!REACTION_TARGETS.includes(targetType as ReactionTarget)) return
  if (!emoji || emoji.length > MAX_EMOJI_LEN) return // любое эмодзи из пикера; защита от мусора
  if (!targetId) return
  const access = await targetListAccess(targetType as ReactionTarget, targetId)
  if (!access || !canViewList(access, { isOwner: access.ownerId === session.userId })) return

  const [existing] = await db
    .select({ id: reactions.id })
    .from(reactions)
    .where(
      and(
        eq(reactions.userId, session.userId),
        eq(reactions.targetType, targetType),
        eq(reactions.targetId, targetId),
        eq(reactions.emoji, emoji),
      ),
    )
    .limit(1)

  if (existing) {
    await db.delete(reactions).where(eq(reactions.id, existing.id))
  } else {
    await db.insert(reactions).values({ userId: session.userId, targetType, targetId, emoji })
  }
  if (path) revalidatePath(path)
}
