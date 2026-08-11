import 'server-only'
import { and, asc, desc, eq, inArray, isNotNull, or, sql } from 'drizzle-orm'
import { agentActions, db, suggestions, templates, users } from '@/shared/db'
import { GARDENER_EVERY_DAYS } from './schedule'

/**
 * Кого садовник трогает в этом проходе: выбор списков-кандидатов и две проверки,
 * которые его удерживают, — сколько версий список уже стоит без правок и не форкнут
 * ли он агентами раньше.
 *
 * Отдельно от самой правки: правила отбора меняются вместе с тем, кого мы считаем
 * заброшенным списком, а не с тем, что предлагаем.
 */

/** Кандидаты: публичные активные, без открытой правки садовника, без секций
 *  (refine пока не сохраняет section) — сначала популярные и давно не обновлявшиеся. */
export async function pickCandidates(agentIds: string[], limit: number, only?: 'living' | 'ordinary') {
  // Дедуп и исключение владельца — по ВСЕМ служебным аккаунтам, а не по одному
  // садовнику: с раздачей ухода профильным специалистам автором правки может быть
  // любой из них, и проверка «уже предлагал» обязана это учитывать (иначе список
  // с открытой правкой Фьялара попадал бы в выборку снова → повторный refine).
  const agents = agentIds.length ? agentIds : ['00000000-0000-0000-0000-000000000000']
  return db
    .select({ id: templates.id, slug: templates.slug, ownerId: templates.ownerId, title: templates.title, desc: templates.desc, tags: templates.tags, currentVersion: templates.currentVersion, listKind: templates.listKind, living: templates.living, status: templates.status, ownerCurated: users.curated, ownerAccountType: users.accountType })
    .from(templates)
    .innerJoin(users, eq(users.id, templates.ownerId))
    .where(
      and(
        // Опубликованные — у любого владельца. СВОИ ЧЕРНОВИКИ — тоже: самогенерация
        // осознанно рождает черновик («публикует человек»), и без этой ветки уход
        // за собственным творчеством не начинался бы вообще — измерено на дев-БД
        // 2026-07-27: у компании 0 опубликованных списков и все её работы в черновиках.
        // Черновик чужого владельца не трогаем: это его незаконченная работа.
        or(eq(templates.status, 'published'), and(eq(templates.status, 'draft'), inArray(users.id, agents))),
        eq(templates.visibility, 'public'),
        eq(templates.moderation, 'active'),
        // Архивные/замороженные списки садовник не трогает (read-only от правок).
        sql`${templates.archivedAt} is null and ${templates.frozenAt} is null`,
        // Списки служебных аккаунтов БОЛЬШЕ НЕ исключаем: раньше стояло
        // notInArray(ownerId, agents) — «правку себе не предлагают», и следствие было
        // обратным задуманному: всё, что компания создала сама, НИКОГДА не улучшалось.
        // Теперь свои списки правятся НАПРЯМУЮ (см. ownerIsAgent ниже), без церемонии
        // «предложить себе», а чужие — предложением, как раньше.
        //
        // Зато исключаем владельцев БЕЗ ВХОДА (сид-фикстуры): проверено 2026-07-27, что
        // все 7 висевших правок были адресованы именно им — принять их некому физически,
        // и такие предложения только копят мусор. Служебные аккаунты тоже без входа,
        // поэтому условие пропускает их отдельно.
        or(
          inArray(users.id, agents),
          isNotNull(users.passwordHash),
          isNotNull(users.githubId),
          isNotNull(users.yandexId),
          isNotNull(users.telegramId),
          isNotNull(users.email),
        ),
        // Не берём список, где служебный участник уже оставил ОТКРЫТУЮ правку ЛИБО
        // что-либо предлагал за последние GARDENER_EVERY_DAYS дней. Второе условие важно
        // для кураторских списков: их правка авто-мёрджится (status='accepted', не 'open'),
        // и без учёта свежести список попадал бы в выборку снова → повторный refine.
        sql`not exists (select 1 from ${suggestions} sg where sg.template_id = ${templates.id} and sg.author_id = any(${sql.param(agents)}::uuid[])
             and (sg.status = 'open' or sg.created_at > now() - (${GARDENER_EVERY_DAYS}::int * interval '1 day')))`,
        // Ленты и обычные списки выбираем РАЗНЫМИ запросами: при общей выборке живые (они идут
        // первыми) вытесняли бы обычные из лимита, и уход выродился бы в одну ленту.
        only === 'living' ? eq(templates.living, true) : only === 'ordinary' ? eq(templates.living, false) : undefined,
      ),
    )
    // Живые списки — первыми: у ленты ценность в свежести, и ждать своей очереди за
    // популярностью она не может. Дальше как раньше: популярные и давно не обновлявшиеся.
    // Внутри лент — сначала те, кого дольше не трогали: иначе одна звёздная лента забирала бы
    // каждый проход, а соседние молчали.
    .orderBy(desc(templates.living), asc(templates.updatedAt), desc(templates.starsCount))
    .limit(limit)
}

/** Сколько раз ПОДРЯД список признан устоявшимся (refine не нашёл, что менять). */
export async function stablePasses(templateId: string): Promise<number> {
  const rows = await db
    .select({ action: agentActions.action })
    .from(agentActions)
    .where(and(eq(agentActions.loop, 'gardener'), sql`${agentActions.signal}->>'templateId' = ${templateId}`))
    .orderBy(desc(agentActions.occurredAt))
    .limit(6)
  let n = 0
  for (const r of rows) {
    // Любое ДЕЙСТВИЕ по списку (правка, форк) обнуляет счётчик: считаем именно «подряд».
    if (r.action !== 'list.stable') break
    n++
  }
  return n
}

/** Уже расходились от этого списка? Один форк на источник — иначе плодим клоны. */
export async function alreadyForked(templateId: string, agents: string[]): Promise<boolean> {
  const [row] = await db
    .select({ id: templates.id })
    .from(templates)
    .where(and(eq(templates.forkedFromId, templateId), inArray(templates.ownerId, agents)))
    .limit(1)
  return !!row
}
