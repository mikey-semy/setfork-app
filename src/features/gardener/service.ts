import 'server-only'
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm'
import { db, jobs, steps, suggestions, templates, templateVersions, users, type ProposedItem } from '@/shared/db'
import { listStore } from '@/features/library/list-store'
import { recheckList } from '@/features/moderation/moderate-list'
import { notifyMany } from '@/features/notifications/notify'
import { getWatcherIds } from '@/features/watch/queries'
import { enqueueReindex } from '@/features/library/jobs'
import { enqueueJob } from '@/shared/jobs/queue'
import { generateListRefine, type GeneratedItem } from '@/shared/ai/generate'
import { globalBudgetOk } from '@/shared/quota'
import { isAiAvailable } from '@/shared/settings/ai'
import { notify } from '@/features/notifications/notify'
import { log } from '@/shared/observability'
import type { LocaleText } from '@/shared/i18n'

// ── ИИ-садовник (Э2) ─────────────────────────────────────────────────
// Прозрачный ИИ-участник: раз в GARDENER_EVERY_DAYS выбирает несколько публичных
// списков и предлагает улучшения ОБЫЧНОЙ правкой (PR-модель) от сервисного
// аккаунта `gardener` — владелец ревьюит и принимает/отклоняет. Ничего не
// публикуется автоматически. Расход пишется в ai_usage (feature 'refine').

const GARDENER_HANDLE = 'gardener'
const GARDENER_EVERY_DAYS = 2
const BATCH = Number(process.env.GARDENER_BATCH ?? 3)

const INSTRUCTION =
  'You are the site gardener improving a community checklist. ' +
  'Clarify vague steps, add missing verification sub-tasks, add a short "why" where the reason is non-obvious, ' +
  'and fix factual or ordering issues. Keep the author’s voice and structure. ' +
  'Add at most 2 new steps and do not remove existing ones unless clearly wrong.'

const locEn = (v: LocaleText | null | undefined): string => {
  if (!v) return ''
  return v.en ?? Object.values(v).find(Boolean) ?? ''
}

/** Сервисный аккаунт садовника (создаётся при первом прогоне; входа у него нет). */
export async function ensureGardenerUser(): Promise<{ id: string }> {
  const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.handle, GARDENER_HANDLE))
  if (existing) return existing
  const [created] = await db
    .insert(users)
    .values({
      handle: GARDENER_HANDLE,
      name: 'SetFork Gardener',
      bio: '\u{1F916} AI gardener. I propose improvements to public lists; humans review and merge.',
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
async function pickCandidates(gardenerId: string, limit: number) {
  return db
    .select({ id: templates.id, slug: templates.slug, ownerId: templates.ownerId, title: templates.title, desc: templates.desc, tags: templates.tags, currentVersion: templates.currentVersion, ownerCurated: users.curated })
    .from(templates)
    .innerJoin(users, eq(users.id, templates.ownerId))
    .where(
      and(
        eq(templates.status, 'published'),
        eq(templates.visibility, 'public'),
        eq(templates.moderation, 'active'),
        sql`${templates.ownerId} <> ${gardenerId}`,
        // Не берём список, где садовник уже оставил ОТКРЫТУЮ правку ЛИБО что-либо
        // предлагал за последние GARDENER_EVERY_DAYS дней. Второе условие важно для
        // кураторских списков: их правка авто-мёрджится (status='accepted', не 'open'),
        // и без учёта свежести список попадал бы в выборку снова → повторный refine.
        sql`not exists (select 1 from ${suggestions} sg where sg.template_id = ${templates.id} and sg.author_id = ${gardenerId}
             and (sg.status = 'open' or sg.created_at > now() - (${GARDENER_EVERY_DAYS}::int * interval '1 day')))`,
        sql`not exists (select 1 from ${steps} st join ${templateVersions} v on v.id = st.version_id
             where v.template_id = ${templates.id} and coalesce(st.section->>'en','') <> '')`,
      ),
    )
    .orderBy(desc(templates.starsCount), asc(templates.updatedAt))
    .limit(limit)
}


// Форма шагов для listStore.addVersion (та же, что toStepInput в library/actions).
function toStepInput(items: ProposedItem[]) {
  return items.map((it, i) => ({
    n: i + 1,
    type: it.type ?? 'step',
    content: it.content ?? {},
    title: it.title,
    desc: it.desc,
    command: it.command,
    level: it.level,
    why: it.why,
    section: it.section,
    subtasks: it.subtasks,
    refs: it.refs,
    imageRef: it.imageKey ?? null,
  }))
}

function toProposed(items: GeneratedItem[]): ProposedItem[] {
  return items.map((it) => ({
    title: { en: it.title.trim() },
    desc: it.desc.trim() ? { en: it.desc.trim() } : {},
    command: (it.command ?? '').trim(),
    hasImage: false,
    level: it.level ?? 'required',
    why: it.why?.trim() ? { en: it.why.trim() } : {},
    section: {},
    subtasks: (it.subtasks ?? []).filter((s) => s.trim()).map((s) => ({ en: s.trim() })),
    refs: (it.refs ?? [])
      .filter((r) => r.label?.trim())
      .map((r) => ({ label: { en: r.label.trim() }, ...(r.url?.trim() ? { url: r.url.trim() } : {}) })),
  }))
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
  const gardener = await ensureGardenerUser()
  const candidates = await pickCandidates(gardener.id, BATCH)

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

    const current = {
      title: locEn(tpl.title),
      desc: locEn(tpl.desc),
      tags: tpl.tags,
      items: rows.map((s) => ({
        title: locEn(s.title),
        desc: locEn(s.desc),
        command: s.command,
        level: s.level,
        why: locEn(s.why),
        subtasks: (s.subtasks ?? []).map(locEn).filter(Boolean),
        refs: (s.refs ?? []).map((r) => ({ label: locEn(r.label), url: r.url ?? '' })),
      })),
    }

    const refined = await generateListRefine(current, INSTRUCTION, 'en', {
      userId: gardener.id,
      feature: 'refine',
      refType: 'template',
      refId: tpl.id,
    })
    if (!refined || !refined.items.length) {
      skipped++
      continue
    }
    // Без изменений — правку не открываем (сравнение по нормализованному контенту).
    const norm = (xs: GeneratedItem[]) => JSON.stringify(toProposed(xs))
    if (norm(refined.items) === norm(current.items as GeneratedItem[])) {
      skipped++
      continue
    }

    const items = toProposed(refined.items)
    const [created] = await db
      .insert(suggestions)
      .values({
        templateId: tpl.id,
        authorId: gardener.id,
        note: '\u{1F916} Gardener: clarified steps, added checks and rationale. Review and merge if useful.',
        baseVersion: tpl.currentVersion,
        items,
      })
      .returning({ id: suggestions.id })

    if (tpl.ownerCurated) {
      // Кураторская библиотека — контент сайта: правка садовника применяется сразу
      // (та же механика, что acceptSuggestion), с атрибуцией в истории и модерацией.
      await listStore.addVersion(tpl.id, { note: '\u{1F916} gardener: refreshed steps', steps: toStepInput(items) })
      await recheckList(tpl.id)
      await db.update(suggestions).set({ status: 'accepted', resolvedAt: new Date() }).where(eq(suggestions.id, created.id))
      await notifyMany(await getWatcherIds(tpl.id), { actorId: gardener.id, type: 'new_version', templateId: tpl.id })
      await enqueueReindex(tpl.id)
      log.info('gardener: auto-merged on curated list', { slug: tpl.slug })
    } else {
      await notify({ recipientId: tpl.ownerId, actorId: gardener.id, type: 'suggestion_new', templateId: tpl.id, suggestionId: created.id })
      log.info('gardener: suggestion opened', { slug: tpl.slug, suggestionId: created.id })
    }
    proposed++
  }
  log.info('gardener sweep done', { candidates: candidates.length, proposed, skipped })
  return { proposed, skipped }
}
