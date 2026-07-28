import 'server-only'
import { and, eq, sql } from 'drizzle-orm'
import { councilExperts, db, issues, suggestions } from '@/shared/db'
import { getRoster } from '@/shared/ai/roster'
import { generateListRefine } from '@/shared/ai/generate'
import { globalBudgetOk } from '@/shared/quota'
import { toProposed } from '@/shared/lib/step-input'
import type { ListKind } from '@/shared/ai/list-kind'
import { getVersionSteps } from './queries'
import { tr, type Lang, type LocaleText } from '@/shared/i18n'
// eslint-disable-next-line boundaries/dependencies -- уведомление владельца о новой правке
import { notify } from '@/features/notifications/notify'

const loc = (v: unknown, lang: Lang): string => tr((v ?? {}) as LocaleText, lang) || ''

/**
 * ГНОМ БЕРЁТ ЗАДАЧУ: назначили задачу гному — он приносит предложение.
 *
 * Это замыкает круг мастерской. Гномы уже были рецензентами, а теперь и
 * исполнителями: задача → предложение → ревью (можно другим гномом) → слияние.
 * Отдельной сущности не заводим — «садовник» это ШЛЯПА, а не агент: работу берёт
 * тот гном, которого назначили, и делает её своим голосом и по своему цеховому
 * кодексу.
 *
 * Генерация — тем же `generateListRefine`, что и у ухода за списками: задача
 * становится инструкцией. Свой промпт здесь означал бы вторую копию правил
 * (сохранить секции, не стирать пометки «нужен человек», не переводить молча),
 * которые уже выверены в общей.
 */
export async function runGnomeIssueTask(
  issueId: string,
  expertId: string,
  lang: Lang,
): Promise<{ ok: true; suggestionId: string } | { ok: false; reason: string }> {
  const [iss] = await db
    .select({
      id: issues.id,
      number: issues.number,
      title: issues.title,
      body: issues.body,
      status: issues.status,
      templateId: issues.templateId,
    })
    .from(issues)
    .where(eq(issues.id, issueId))
    .limit(1)
  if (!iss || iss.status !== 'open') return { ok: false, reason: 'issue is not open' }

  const tpl = await db.query.templates.findFirst({ where: (t) => eq(t.id, iss.templateId) })
  if (!tpl) return { ok: false, reason: 'list not found' }

  const [expert] = (await getRoster()).filter((e) => e.id === expertId)
  if (!expert) return { ok: false, reason: `unknown gnome ${expertId}` }
  const [acc] = await db.select({ userId: councilExperts.userId }).from(councilExperts).where(eq(councilExperts.id, expertId)).limit(1)
  if (!acc?.userId) return { ok: false, reason: 'gnome has no account' }
  if (!(await globalBudgetOk())) return { ok: false, reason: 'AI budget exhausted' }

  // Одна открытая правка от этого гнома по этой задаче — второй проход не должен
  // плодить дубли (задачу могли переназначить туда-обратно).
  const [dup] = await db
    .select({ id: suggestions.id })
    .from(suggestions)
    .where(
      and(
        eq(suggestions.templateId, tpl.id),
        eq(suggestions.authorId, acc.userId),
        eq(suggestions.status, 'open'),
        sql`${suggestions.note} like ${'%#' + iss.number + '%'}`,
      ),
    )
    .limit(1)
  if (dup) return { ok: false, reason: 'already working on it' }

  // Шаги принадлежат ВЕРСИИ, а не списку: берём текущую — правку гном предлагает
  // именно к ней (её же номер уйдёт в baseVersion).
  const version = await getVersionSteps(tpl.id, tpl.currentVersion)
  const rows = version?.steps ?? []
  if (rows.length === 0) return { ok: false, reason: 'list has no steps' }
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
      // Пометки «здесь нужен человек» обязаны попасть в снимок: refine возвращает
      // список ЦЕЛИКОМ, и поля, которого в снимке нет, в результате не будет.
      needsHuman: s.needsHuman,
      needsHumanAsk: loc(s.needsHumanAsk, lang),
      subtasks: (s.subtasks ?? []).map((x) => loc(x, lang)).filter(Boolean),
      refs: (s.refs ?? []).map((r) => ({ label: loc(r.label, lang), url: r.url ?? '' })),
    })),
  }

  // Голос гнома — в инструкции: цеховой кодекс задаёт планку, по которой он и
  // будет работать. Текст задачи идёт как есть: это ТЗ от человека.
  const guild = expert.code ? `\nТвой цеховой кодекс (планка качества):\n${expert.code}` : ''
  const instruction = [
    `Ты ${expert.persona}.${guild}`,
    '',
    'Тебе поручили задачу по этому списку. Сделай ровно то, о чём она просит — не больше:',
    `Задача #${iss.number}: ${iss.title}`,
    iss.body ? `\n${iss.body.slice(0, 2000)}` : '',
  ].join('\n')

  const refined = await generateListRefine(current, instruction, lang, {
    userId: acc.userId,
    feature: 'refine',
    refType: 'template',
    refId: tpl.id,
    kind: (tpl.listKind as ListKind | null) ?? undefined,
  })
  if (!refined || !refined.items.length) return { ok: false, reason: 'the gnome produced nothing' }

  const items = toProposed(refined.items, lang)
  // «closes #N» в заметке — не украшение: по нему задача закроется при слиянии
  // (тот же разбор, что у людей). Ради этого задача и связывается с правкой.
  const note = `${iss.title.slice(0, 200)}\ncloses #${iss.number}`
  const [created] = await db
    .insert(suggestions)
    .values({
      templateId: tpl.id,
      authorId: acc.userId,
      note,
      baseVersion: tpl.currentVersion,
      items,
      number: sql`(select coalesce(max(number), 0) + 1 from suggestions where template_id = ${tpl.id})`,
    })
    .returning({ id: suggestions.id })
  if (!created) return { ok: false, reason: 'could not create the suggestion' }

  await notify({
    recipientId: tpl.ownerId,
    actorId: acc.userId,
    type: 'suggestion_new',
    templateId: tpl.id,
    suggestionId: created.id,
  })
  return { ok: true, suggestionId: created.id }
}
