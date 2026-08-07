import 'server-only'
import { desc, eq } from 'drizzle-orm'
import { db, knowledgeSources, users } from '@/shared/db'
import { isAdminHandle } from '@/shared/auth/admin-handle'
import { recordAgentAction } from '@/shared/agents/policy'
import { attributionLine, checkLicense } from '@/shared/ai/source-license'

/**
 * Источники знаний: агент регистрирует, откуда взял материал, и смотрит уже
 * зарегистрированные. Своя причина меняться — правила лицензий и атрибуции.
 */

export async function mcpRegisterSource(
  userId: string,
  input: { url: string; title?: string; license: string; attribution?: string; note?: string },
) {
  // Реестр источников ОБЩИЙ для компании: по нему решают, что можно брать в корпус.
  // Обычный write-токен сюда пускать нельзя — любой вошедший мог бы объявить чужой
  // материал свободным или переписать лицензию у уже проверенного источника.
  // Юридический вердикт даёт человек, отвечающий за него, а не всякий, у кого есть токен.
  const [me] = await db.select({ handle: users.handle }).from(users).where(eq(users.id, userId)).limit(1)
  if (!isAdminHandle(me?.handle ?? null)) {
    return { error: 'only an administrator can register sources — the license verdict is a legal decision' }
  }
  const url = (input.url ?? '').trim()
  if (!/^https?:\/\//i.test(url)) return { error: 'url must be an http(s) address' }
  const verdict = checkLicense(input.license ?? '', input.attribution ?? '')
  if (!verdict.ok || !verdict.license) return { error: `нельзя брать: ${verdict.reason}` }

  const [row] = await db
    .insert(knowledgeSources)
    .values({
      url,
      title: (input.title ?? '').trim().slice(0, 200),
      license: verdict.license,
      attribution: (input.attribution ?? '').trim().slice(0, 200),
      note: (input.note ?? '').trim().slice(0, 500),
      addedBy: userId,
    })
    .onConflictDoUpdate({
      target: knowledgeSources.url,
      set: {
        title: (input.title ?? '').trim().slice(0, 200),
        license: verdict.license,
        attribution: (input.attribution ?? '').trim().slice(0, 200),
        note: (input.note ?? '').trim().slice(0, 500),
      },
    })
    .returning({ id: knowledgeSources.id, license: knowledgeSources.license })

  await recordAgentAction({
    loop: 'mcp',
    action: 'source.register',
    resultStatus: 'ok',
    actorUserId: userId,
    principalMode: 'on_behalf_of',
    signal: { url },
    decision: { license: row.license, requiresAttribution: !!(input.attribution ?? '').trim() },
    resultRef: url.slice(0, 300),
  })
  return {
    id: row.id,
    license: row.license,
    attribution: attributionLine(verdict.license, input.attribution ?? '', url),
    note: verdict.reason,
  }
}

/** Зарегистрированные источники — что вообще разрешено цитировать и копировать. */
export async function mcpListSources(limit = 50) {
  const rows = await db
    .select({ url: knowledgeSources.url, title: knowledgeSources.title, license: knowledgeSources.license, attribution: knowledgeSources.attribution, note: knowledgeSources.note })
    .from(knowledgeSources)
    .orderBy(desc(knowledgeSources.createdAt))
    .limit(Math.min(200, Math.max(1, limit)))
  return { sources: rows.length, allowed: rows }
}
