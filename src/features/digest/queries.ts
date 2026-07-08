import 'server-only'
import { sql } from 'drizzle-orm'
import { db } from '@/shared/db'

// Недельный дайджест «сохранённое дорожает». Три секции; каждая считает
// изменения ПОСЛЕ max(момент сохранения/форка, since) — точка отсчёта письма.
// Прототип отработан на данных симуляции (setfork-sim/src/analysis/digest.sql).

export interface StarredItem {
  slug: string
  owner: string
  newVersions: number
  notes: string[]
  improvedBy: string[]
}

export interface UpstreamItem {
  slug: string // slug ОРИГИНАЛА (апстрима)
  owner: string
  newVersions: number
}

export interface OwnListItem {
  slug: string
  open: number
  accepted: number
  authors: string[]
}

export interface Digest {
  starred: StarredItem[]
  upstream: UpstreamItem[]
  ownLists: OwnListItem[]
}

export function digestSize(d: Digest): number {
  return d.starred.length + d.upstream.length + d.ownLists.length
}

/** Собрать дайджест пользователя с момента since. Пустой = письмо не шлём. */
export async function buildDigest(userId: string, since: Date): Promise<Digest> {
  // Три секции независимы — читаем параллельно.
  const [starred, upstream, ownLists] = await Promise.all([
    // 1) «Твои сохранения стали лучше»: новые версии застаренных списков после звезды.
    db.execute(sql`
    select t.slug,
           u.handle as owner,
           count(v.id)::int as new_versions,
           coalesce(array_agg(distinct v.note) filter (where v.note <> ''), '{}') as notes,
           coalesce(array_agg(distinct au.handle) filter (where au.handle is not null), '{}') as improved_by
    from stars s
    join templates t on t.id = s.template_id
    join users u on u.id = t.owner_id
    join template_versions v
      on v.template_id = t.id and v.created_at > greatest(s.created_at, ${since})
    left join suggestions sg
      on sg.template_id = t.id and sg.status = 'accepted'
     and sg.resolved_at > greatest(s.created_at, ${since})
    left join users au on au.id = sg.author_id
    where s.user_id = ${userId}
      and t.visibility = 'public' and t.status = 'published' and t.moderation = 'active'
      and t.owner_id <> ${userId}
    group by t.slug, u.handle
    order by count(v.id) desc
    limit 10`),

    // 2) «Апстрим твоего форка ушёл вперёд»: версии оригинала после момента форка.
    db.execute(sql`
    select p.slug, u.handle as owner, count(v.id)::int as new_versions
    from templates f
    join templates p on p.id = f.forked_from_id
    join users u on u.id = p.owner_id
    join template_versions v
      on v.template_id = p.id and v.created_at > greatest(f.created_at, ${since})
    where f.owner_id = ${userId}
      and p.visibility = 'public' and p.status = 'published' and p.moderation = 'active'
    group by p.slug, u.handle
    order by count(v.id) desc
    limit 10`),

    // 3) «На твои списки пришло внимание»: правки за период (открытые = call-to-action).
    db.execute(sql`
    select t.slug,
           count(*) filter (where sg.status = 'open')::int as open,
           count(*) filter (where sg.status = 'accepted')::int as accepted,
           coalesce(array_agg(distinct au.handle), '{}') as authors
    from templates t
    join suggestions sg on sg.template_id = t.id and sg.created_at > ${since}
    join users au on au.id = sg.author_id
    where t.owner_id = ${userId}
    group by t.slug
    order by count(*) desc
    limit 10`),
  ])

  return {
    starred: starred.rows.map((r) => ({
      slug: String(r.slug),
      owner: String(r.owner),
      newVersions: Number(r.new_versions),
      notes: (r.notes as string[]) ?? [],
      improvedBy: (r.improved_by as string[]) ?? [],
    })),
    upstream: upstream.rows.map((r) => ({
      slug: String(r.slug),
      owner: String(r.owner),
      newVersions: Number(r.new_versions),
    })),
    ownLists: ownLists.rows.map((r) => ({
      slug: String(r.slug),
      open: Number(r.open),
      accepted: Number(r.accepted),
      authors: (r.authors as string[]) ?? [],
    })),
  }
}
