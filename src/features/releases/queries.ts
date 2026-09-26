import 'server-only'
import { and, asc, desc, eq, sql } from 'drizzle-orm'
import { db, releases, users } from '@/shared/db'
import { feedWindow } from '@/shared/lib/paging'
import { avatarSrc } from '@/shared/media'

export interface ReleaseRow {
  id: string
  version: number
  tag: string
  title: string
  notes: string
  prerelease: boolean
  createdAt: Date
  authorHandle: string
  authorAvatarUrl: string | null
}

/** Сколько всего релизов у списка — для числа страниц. */
export async function countReleases(templateId: string): Promise<number> {
  const [r] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(releases)
    .where(eq(releases.templateId, templateId))
  return r?.n ?? 0
}

/**
 * Какой релиз считается ПОСЛЕДНИМ — отдельным запросом, а не поиском по показанной странице.
 *
 * Раньше метка «последний» ставилась первому не-пред-релизу в полной выдаче. Со страницами
 * так нельзя: попадись на первой странице одни пред-релизы — метка уехала бы на вторую и
 * встала не на тот релиз. Один запрос на одну строку отвечает точно и не зависит от того,
 * какую страницу открыли.
 */
export async function getLatestReleaseId(templateId: string): Promise<string | null> {
  return (await getLatestRelease(templateId))?.id ?? null
}

/** Последний релиз целиком — тег и правка, из которой он выпущен. */
export interface LatestRelease {
  id: string
  tag: string
  version: number
}

/**
 * Последний релиз: новейший НЕ пред-релиз (как «Latest» у GitHub). Одно правило на
 * метку «последний» в каталоге релизов и на версию скилла в сводке списка.
 */
export async function getLatestRelease(templateId: string): Promise<LatestRelease | null> {
  const [r] = await db
    .select({ id: releases.id, tag: releases.tag, version: releases.version })
    .from(releases)
    .where(and(eq(releases.templateId, templateId), eq(releases.prerelease, false)))
    .orderBy(desc(releases.createdAt), asc(releases.id))
    .limit(1)
  return r ?? null
}

/**
 * Релизы списка, новые сверху.
 *
 * Релизы — каталог, по нему прыгают («что было в 1.2»), поэтому номера, а не курсор.
 * Смещение при этом дрейфует так же, как у задач (новый релиз встаёт сверху) — но релизы
 * выпускают редко, а прыжок на страницу нужен постоянно.
 * Раньше выдача шла без предела и без доопределения порядка: `createdAt` у релизов,
 * созданных одной операцией, совпадает, и на равных ключах страницы теряли бы строки.
 *
 * Окно необязательно: сборка changelog (features/releases/changelog) берёт ВСЕ релизы,
 * и это не лента, а агрегат — резать его страницами бессмысленно.
 */
export async function getReleases(
  templateId: string,
  window?: { limit: number; offset?: number },
): Promise<ReleaseRow[]> {
  const base = db
    .select({
      id: releases.id,
      version: releases.version,
      tag: releases.tag,
      title: releases.title,
      notes: releases.notes,
      prerelease: releases.prerelease,
      createdAt: releases.createdAt,
      authorHandle: users.handle,
      authorAvatarUrl: users.avatarUrl,
    })
    .from(releases)
    .innerJoin(users, eq(releases.authorId, users.id))
    .where(eq(releases.templateId, templateId))
    .orderBy(desc(releases.createdAt), asc(releases.id))
  const w = window && feedWindow(window)
  const rows = await (w ? base.limit(w.limit).offset(w.offset) : base)
  return Promise.all(rows.map(async (r) => ({ ...r, authorAvatarUrl: await avatarSrc(r.authorAvatarUrl, 48) })))
}

/**
 * Номера версий, на которых стоят релизы, — всё, что нужно сборке заметок.
 *
 * Сборка брала `getReleases` целиком: с заметками до 50 000 символов и подписью
 * аватара на каждую строку, — чтобы прочитать из них одно число. На списке с сотнями
 * релизов это мегабайты ради пары номеров, а через MCP сборку зовут дёшево.
 */
export async function getReleaseVersions(templateId: string): Promise<{ version: number }[]> {
  return db.select({ version: releases.version }).from(releases).where(eq(releases.templateId, templateId))
}
