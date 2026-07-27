import 'server-only'
import { and, asc, desc, eq, inArray, isNotNull, or, sql } from 'drizzle-orm'
import { appSettings, db, jobs, steps, suggestions, templates, templateVersions, users, type ProposedItem } from '@/shared/db'
import { listStore } from '@/features/library/list-store'
import { notifyMany } from '@/features/notifications/notify'
import { getWatcherIds } from '@/features/watch/queries'
import { enqueueReindex } from '@/features/library/jobs'
import { enqueueJob } from '@/shared/jobs/queue'
import { generateListRefine, type GeneratedItem } from '@/shared/ai/generate'
import { LIST_KINDS, type ListKind } from '@/shared/ai/list-kind'
import { POLICY_SETTING_KEYS, dominantLang, inferListKind, policyFor, policySettingKey } from '@/shared/ai/gardener-policies'
import { globalBudgetOk } from '@/shared/quota'
import { isAiAvailable } from '@/shared/settings/ai'
import { notify } from '@/features/notifications/notify'
import { log } from '@/shared/observability'
import { toProposed, toStepInput } from '@/shared/lib/step-input'
import { HOME_REALM } from '@/shared/ai/gnome-names'
import { agentUserIds, professionOf, tenderForTags } from '@/shared/ai/gnome-account'
import { loopPolicy, recordAgentAction } from '@/shared/agents/policy'
import { getRoster } from '@/shared/ai/roster'
import { t, type Lang, type LocaleText } from '@/shared/i18n'

// ── ИИ-садовник (Э2 → ось B «живые списки») ──────────────────────────
// Прозрачный ИИ-участник: раз в GARDENER_EVERY_DAYS выбирает несколько публичных
// списков и предлагает улучшения ОБЫЧНОЙ правкой (PR-модель) от сервисного
// аккаунта `gardener` — владелец ревьюит и принимает/отклоняет. Ничего не
// публикуется автоматически. Расход пишется в ai_usage (feature 'refine').
// Правка идёт НА ЯЗЫКЕ СПИСКА и ПО ПОЛИТИКЕ ЕГО ТИПА (рецепт: точные
// количества; процедура: актуальность команд — см. gardener-policies).

const GARDENER_HANDLE = 'gardener'
const GARDENER_EVERY_DAYS = 2
const BATCH = Number(process.env.GARDENER_BATCH ?? 3)

/** Значение LocaleText на языке списка (фолбэк en → первый непустой). */
const loc = (v: LocaleText | null | undefined, lang: Lang): string => {
  if (!v) return ''
  return v[lang] ?? v.en ?? Object.values(v).find(Boolean) ?? ''
}

/**
 * Сервисный аккаунт садовника (создаётся при первом прогоне; входа у него нет).
 *
 * Существующую строку ДОЧИНИВАЕМ: на проде садовник был создан раньше, чем появилась
 * пометка account_type, и после деплоя остался бы «человеком» — то есть ровно то, что
 * ADR-0004 запрещает. Разовым скриптом такое чинить нельзя: он забывается, а инвариант
 * должен держать код. Апдейт узкий (только пустые/дефолтные поля) и идемпотентный —
 * заданные вручную значения не перетираем.
 */
export async function ensureGardenerUser(): Promise<{ id: string }> {
  const [existing] = await db
    .select({ id: users.id, accountType: users.accountType, profession: users.profession, location: users.location })
    .from(users)
    .where(eq(users.handle, GARDENER_HANDLE))
  if (existing) {
    if (existing.accountType !== 'agent' || !existing.profession || !existing.location) {
      await db
        .update(users)
        .set({
          accountType: 'agent',
          profession: existing.profession || 'Gardener',
          location: existing.location || HOME_REALM,
        })
        .where(eq(users.id, existing.id))
      log.info('gardener user marked as service account', { id: existing.id })
    }
    return { id: existing.id }
  }
  const [created] = await db
    .insert(users)
    .values({
      handle: GARDENER_HANDLE,
      name: 'SetFork Gardener',
      // account_type='agent' (ADR-0004): служебность стала ДАННЫМИ, а не догадкой по
      // handle и эмодзи в bio — UI и API обязаны показывать, что это не человек.
      accountType: 'agent',
      profession: 'Gardener',
      location: HOME_REALM,
      bio: '\u{1F9D9} Gardener. I propose improvements to public lists; humans review and merge.',
    })
    .returning({ id: users.id })
  log.info('gardener user created', { id: created.id })
  return created
}

/** Одна pending/processing джоба садовника в очереди — самоподдержание без cron. */
export async function ensureGardenerScheduled(): Promise<void> {
  const pending = await db
    .select({ id: jobs.id })
    .from(jobs)
    .where(and(eq(jobs.type, 'gardener'), inArray(jobs.status, ['pending', 'processing'])))
    .limit(1)
  if (pending.length) return
  // maxAttempts:1 — без ретрая всего прохода: при повторе уже авто-смёрдженные
  // кураторские списки рефайнились бы заново (двойной расход). Пропуск одного
  // прохода не страшен — следующий встаёт по расписанию.
  await enqueueJob('gardener', {}, { delayMs: GARDENER_EVERY_DAYS * 24 * 60 * 60 * 1000, maxAttempts: 1 })
  log.info('gardener scheduled', { inDays: GARDENER_EVERY_DAYS })
}

/** Кандидаты: публичные активные, без открытой правки садовника, без секций
 *  (refine пока не сохраняет section) — сначала популярные и давно не обновлявшиеся. */
export async function pickCandidates(agentIds: string[], limit: number) {
  // Дедуп и исключение владельца — по ВСЕМ служебным аккаунтам, а не по одному
  // садовнику: с раздачей ухода профильным специалистам автором правки может быть
  // любой из них, и проверка «уже предлагал» обязана это учитывать (иначе список
  // с открытой правкой Фьялара попадал бы в выборку снова → повторный refine).
  const agents = agentIds.length ? agentIds : ['00000000-0000-0000-0000-000000000000']
  return db
    .select({ id: templates.id, slug: templates.slug, ownerId: templates.ownerId, title: templates.title, desc: templates.desc, tags: templates.tags, currentVersion: templates.currentVersion, listKind: templates.listKind, ownerCurated: users.curated, ownerAccountType: users.accountType })
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
      ),
    )
    .orderBy(desc(templates.starsCount), asc(templates.updatedAt))
    .limit(limit)
}

/** Override-политики из админки (app_settings gardener.policy.<kind>); пусто = код-дефолты. */
async function policyOverrides(): Promise<Partial<Record<ListKind, string>>> {
  const rows = await db.select().from(appSettings).where(inArray(appSettings.key, POLICY_SETTING_KEYS))
  const out: Partial<Record<ListKind, string>> = {}
  for (const kind of LIST_KINDS) {
    const v = rows.find((r) => r.key === policySettingKey(kind))?.value?.trim()
    if (v) out[kind] = v
  }
  return out
}

/** Note правки — на языке списка, с честным описанием того, что делал садовник. */
function noteFor(kind: ListKind, lang: Lang): string {
  return t(kind === 'recipe' ? 'gardenerNoteRecipe' : 'gardenerNoteDefault', lang)
}



/** Прогон садовника: до BATCH списков за раз, каждый — refine → suggestion. */
export async function runGardenerSweep(): Promise<{ proposed: number; skipped: number }> {
  if (!(await isAiAvailable())) {
    log.info('gardener: AI unavailable, skipping')
    return { proposed: 0, skipped: 0 }
  }
  // Фоновый расход без участия человека — уважаем глобальный дневной кап инстанса.
  if (!(await globalBudgetOk())) {
    log.info('gardener: global AI budget exhausted, skipping')
    return { proposed: 0, skipped: 0 }
  }
  const loop = await loopPolicy('gardener')
  const gardener = await ensureGardenerUser()
  const [agents, roster] = await Promise.all([agentUserIds(), getRoster()])
  const [candidates, overrides] = await Promise.all([pickCandidates(agents, BATCH), policyOverrides()])

  let proposed = 0
  let skipped = 0
  for (const tpl of candidates) {
    const [ver] = await db
      .select({ id: templateVersions.id })
      .from(templateVersions)
      .where(and(eq(templateVersions.templateId, tpl.id), eq(templateVersions.version, tpl.currentVersion)))
    const rows = ver
      ? await db.select().from(steps).where(eq(steps.versionId, ver.id)).orderBy(asc(steps.n))
      : []

    // Язык списка — по его контенту (раньше RU-список рефайнился на английском
    // и садовник предлагал перевод вместо улучшения).
    const lang = dominantLang([tpl.title, tpl.desc, ...rows.map((s) => s.title)])
    // Тип списка: колонка → структурная эвристика → грамматика заголовка;
    // определённое лениво дозаписываем (самозаполняющийся бэкфилл).
    const kind: ListKind = (LIST_KINDS as readonly string[]).includes(tpl.listKind ?? '')
      ? (tpl.listKind as ListKind)
      : inferListKind({
          title: loc(tpl.title, lang),
          sections: rows.map((s) => loc(s.section, lang)).filter(Boolean),
          commandCount: rows.filter((s) => s.command.trim()).length,
        })
    if (!tpl.listKind) await db.update(templates).set({ listKind: kind }).where(eq(templates.id, tpl.id))

    const current = {
      title: loc(tpl.title, lang),
      desc: loc(tpl.desc, lang),
      tags: tpl.tags,
      items: rows.map((s) => ({
        title: loc(s.title, lang),
        desc: loc(s.desc, lang),
        command: s.command,
        section: loc(s.section, lang),
        level: s.level,
        why: loc(s.why, lang),
        subtasks: (s.subtasks ?? []).map((x) => loc(x, lang)).filter(Boolean),
        refs: (s.refs ?? []).map((r) => ({ label: loc(r.label, lang), url: r.url ?? '' })),
      })),
    }

    // Сорняки (HQ §9): обход ссылок списка КОДОМ до refine. Уверенно мёртвые
    // (404/410) отдаём садовнику-LLM на замену — подбор живого источника как раз
    // его работа. 'unknown' (geo-блок/бот-защита с RU-сервера) не трогаем.
    const { checkUrls } = await import('@/shared/lib/link-health')
    const refUrls = current.items.flatMap((it) => it.refs.map((r) => r.url)).filter(Boolean)
    const verdicts = refUrls.length ? await checkUrls(refUrls) : new Map<string, string>()
    const deadUrls = [...verdicts.entries()].filter(([, v]) => v === 'dead').map(([u]) => u)
    // Инструкция = политика ТИПА списка (+ замена мёртвых ссылок, если нашлись).
    const policy = policyFor(kind, overrides)
    const instruction = deadUrls.length
      ? `${policy}\nDEAD LINKS (verified 404/410 by the site, not a guess) — replace each with a working authoritative source or drop the ref: ${deadUrls.join(' ')}`
      : policy

    // Шляпу садовника надевает ПРОФИЛЬНЫЙ специалист (решение владельца): кулинарный
    // список правит повар — он в рецептах и разбирается. «Садовник» остаётся именем
    // функции (следить за ростом качества), а не отдельным персонажем. Никто по домену
    // не подошёл → общий служебный аккаунт, как раньше.
    const tender = await tenderForTags(tpl.tags, roster)
    const tenderId = tender?.userId ?? gardener.id
    const ownedByCompany = tpl.ownerAccountType === 'agent'

    // СУХОЙ ПРОГОН: кого выбрали и что нашли — в журнал, refine НЕ зовём (он платный).
    // Проверка стоит до вызова модели и после выбора мастера, чтобы в журнале было
    // видно настоящее решение петли, а не заготовку.
    if (loop.dryRun) {
      await recordAgentAction({
        loop: 'gardener',
        action: ownedByCompany ? 'list.improve' : 'list.suggest',
        resultStatus: 'dry-run',
        agentId: tender?.expert.id ?? '',
        actorUserId: tenderId,
        signal: { trigger: 'schedule', slug: tpl.slug, deadLinks: deadUrls.length },
        decision: { mode: ownedByCompany ? 'direct-edit' : 'suggestion', profession: tender ? professionOf(tender.expert, 'en') : 'generic' },
        policyVersion: loop.policyVersion,
      })
      skipped++
      continue
    }

    const refined = await generateListRefine(current, instruction, lang, {
      userId: tenderId,
      feature: 'refine',
      refType: 'template',
      refId: tpl.id,
      kind,
    })
    if (!refined || !refined.items.length) {
      skipped++
      continue
    }
    // Без изменений — правку не открываем (сравнение по нормализованному контенту).
    const norm = (xs: GeneratedItem[]) => JSON.stringify(toProposed(xs, lang))
    if (norm(refined.items) === norm(current.items as GeneratedItem[])) {
      skipped++
      continue
    }

    const items = toProposed(refined.items, lang)
    const note = noteFor(kind, lang) + (deadUrls.length ? ' ' + t('gardenerNoteDeadLinks', lang).replace('{n}', String(deadUrls.length)) : '')

    // СВОЙ СПИСОК компания правит НАПРЯМУЮ. Предложение самому себе — церемония без
    // получателя: принимать его некому, и оно просто копилось бы открытым. Именно из-за
    // такого разрыва всё, созданное компанией, ранее не улучшалось вовсе.
    if (ownedByCompany) {
      await listStore.addVersion(tpl.id, { note: note, steps: toStepInput(items), authorId: tenderId })
      await notifyMany(await getWatcherIds(tpl.id, 'versions'), { actorId: tenderId, type: 'new_version', templateId: tpl.id })
      await enqueueReindex(tpl.id)
      await recordAgentAction({
        loop: 'gardener',
        action: 'list.improve',
        resultStatus: 'ok',
        agentId: tender?.expert.id ?? '',
        actorUserId: tenderId,
        signal: { trigger: 'schedule', slug: tpl.slug, deadLinks: deadUrls.length },
        decision: { mode: 'direct-edit', reason: 'company-owned list — no receiver for a suggestion' },
        resultRef: tpl.slug,
        policyVersion: loop.policyVersion,
      })
      proposed++
      log.info('gardener: own list improved directly', { slug: tpl.slug, tender: tender?.expert.id ?? 'generic' })
      continue
    }

    const [created] = await db
      .insert(suggestions)
      .values({
        templateId: tpl.id,
        authorId: tenderId,
        note,
        baseVersion: tpl.currentVersion,
        items,
        number: sql`(select coalesce(max(number), 0) + 1 from suggestions where template_id = ${tpl.id})`,
      })
      .returning({ id: suggestions.id })

    // Рецепты НЕ авто-мёрджим даже на кураторских — правка количеств требует
    // человеческого глаза, пока качество recipe-политики не оценено вручную.
    if (tpl.ownerCurated && kind !== 'recipe') {
      // Кураторская библиотека — контент сайта: правка садовника применяется сразу
      // (та же механика, что acceptSuggestion), с атрибуцией в истории и модерацией.
      // recheck публичного списка — в фасаде listStore.addVersion (барьер), здесь не дублируем.
      await listStore.addVersion(tpl.id, { note: '\u{1F9D9} gardener: refreshed steps', steps: toStepInput(items), authorId: tenderId })
      await db.update(suggestions).set({ status: 'accepted', resolvedAt: new Date() }).where(eq(suggestions.id, created.id))
      await notifyMany(await getWatcherIds(tpl.id, 'versions'), { actorId: tenderId, type: 'new_version', templateId: tpl.id })
      await enqueueReindex(tpl.id)
      log.info('gardener: auto-merged on curated list', { slug: tpl.slug })
    } else {
      await notify({ recipientId: tpl.ownerId, actorId: tenderId, type: 'suggestion_new', templateId: tpl.id, suggestionId: created.id })
      log.info('gardener: suggestion opened', { slug: tpl.slug, suggestionId: created.id, tender: tender?.expert.id ?? 'generic' })
    }
    proposed++
  }
  log.info('gardener sweep done', { candidates: candidates.length, proposed, skipped })
  return { proposed, skipped }
}
