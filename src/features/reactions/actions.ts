'use server'
import { and, eq } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { requireSession } from '@/shared/auth/session'
import { db, issueComments, issues, reactions, suggestionComments, suggestions } from '@/shared/db'
import { REACTION_EMOJI, REACTION_TARGETS, type ReactionTarget } from './constants'

// Проверка, что цель реально существует (лёгкая целостность/скоуп).
async function targetExists(targetType: ReactionTarget, id: string): Promise<boolean> {
  const one = async (table: typeof issues | typeof issueComments | typeof suggestions | typeof suggestionComments) => {
    const [r] = await db.select({ id: table.id }).from(table).where(eq(table.id, id)).limit(1)
    return !!r
  }
  switch (targetType) {
    case 'issue':
      return one(issues)
    case 'issue_comment':
      return one(issueComments)
    case 'suggestion':
      return one(suggestions)
    case 'suggestion_comment':
      return one(suggestionComments)
    default:
      return false
  }
}

/** Тоггл реакции текущего пользователя (эмодзи на цель). Ревалидирует переданный путь. */
export async function toggleReaction(input: {
  targetType: string
  targetId: string
  emoji: string
  path: string
}): Promise<void> {
  const session = await requireSession()
  const { targetType, targetId, emoji, path } = input
  if (!REACTION_TARGETS.includes(targetType as ReactionTarget)) return
  if (!(REACTION_EMOJI as readonly string[]).includes(emoji)) return
  if (!targetId) return
  if (!(await targetExists(targetType as ReactionTarget, targetId))) return

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
