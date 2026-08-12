import 'server-only'
import { eq } from 'drizzle-orm'
import { db, templates, users, type ProposedItem } from '@/shared/db'
import { branchRevision, itemsRevision } from '../suggestion-revision'
import { gitPort } from './git-port'

/**
 * Текущая ревизия предложения — то, что сейчас предлагается слить.
 *
 * У предложения из ветки это её tip (новый коммит меняет ревизию), у предложения из
 * пунктов — отпечаток самих пунктов. Ветка недоступна (репозитория нет, ветку
 * удалили) → null: тогда сверять не с чем, и устаревшими проверки не объявляем —
 * иначе недоступность git превращалась бы в блокировку слияния.
 */
export async function currentRevision(sug: { id: string; branchRef: string | null; items: unknown; templateId: string }): Promise<string | null> {
  if (!sug.branchRef) return itemsRevision((sug.items ?? []) as ProposedItem[])
  const [tpl] = await db.select({ slug: templates.slug, ownerId: templates.ownerId }).from(templates).where(eq(templates.id, sug.templateId)).limit(1)
  if (!tpl) return null
  const [owner] = await db.select({ handle: users.handle }).from(users).where(eq(users.id, tpl.ownerId)).limit(1)
  const { gitCore } = await gitPort()
  const snap = await gitCore.branchSnapshot({ owner: owner?.handle ?? '', slug: tpl.slug }, sug.branchRef).catch(() => null)
  return snap?.tipSha ? branchRevision(snap.tipSha) : null
}
