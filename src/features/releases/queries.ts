import 'server-only'
import { and, desc, eq } from 'drizzle-orm'
import { db, releases, users } from '@/shared/db'
import { avatarSrc } from '@/shared/media'

export interface ReleaseRow {
  id: string
  version: number
  tag: string
  title: string
  notes: string
  createdAt: Date
  authorHandle: string
  authorAvatarUrl: string | null
}

/** Релизы списка, новые сверху (первый = latest). */
export async function getReleases(templateId: string): Promise<ReleaseRow[]> {
  const rows = await db
    .select({
      id: releases.id,
      version: releases.version,
      tag: releases.tag,
      title: releases.title,
      notes: releases.notes,
      createdAt: releases.createdAt,
      authorHandle: users.handle,
      authorAvatarUrl: users.avatarUrl,
    })
    .from(releases)
    .innerJoin(users, eq(releases.authorId, users.id))
    .where(eq(releases.templateId, templateId))
    .orderBy(desc(releases.createdAt))
  return Promise.all(rows.map(async (r) => ({ ...r, authorAvatarUrl: await avatarSrc(r.authorAvatarUrl, 48) })))
}

/** Тег уже занят? (подсказка в форме до сабмита не нужна — проверка в action). */
export async function tagTaken(templateId: string, tag: string): Promise<boolean> {
  const [r] = await db
    .select({ id: releases.id })
    .from(releases)
    .where(and(eq(releases.templateId, templateId), eq(releases.tag, tag)))
    .limit(1)
  return !!r
}
