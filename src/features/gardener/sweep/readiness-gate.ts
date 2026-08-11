// Планка готовности своего черновика: публиковать без человека или держать с
// причинами. Причина измениться одна — правила, по которым компания решается
// показать собственный список: структурные признаки, линзы, класс полноты,
// суточная квота канарейки.

import 'server-only'
import { eq } from 'drizzle-orm'
import { db, templates } from '@/shared/db'
import { enqueueReindex } from '@/features/library/jobs'
import { globalBudgetOk } from '@/shared/quota'
import { countDuplicateSteps, readinessDecision, structuralBlockers, DEFAULT_BAR, type ReadinessBar, type ReadinessFacts } from '@/shared/ai/readiness'
import { featuresOf, gradeList } from '@/shared/ai/list-grade'
import { runReadinessLenses, type ReadinessInput } from '@/shared/ai/readiness-lenses'
import { checkUrls } from '@/shared/lib/link-health'
import { getAiSettings } from '@/shared/settings/ai'
import { log } from '@/shared/observability'
import { recordAgentAction } from '@/shared/agents/policy'
import { publishQuotaLeft } from '@/shared/agents/canary'
import { moderateNewPublication } from '@/shared/agents/publication'
import type { Lang } from '@/shared/i18n'

/**
 * ГЕЙТ ГОТОВНОСТИ своего черновика: публикуем без человека или оставляем с причинами.
 *
 * Почему здесь, а не отдельной петлёй: гейт имеет смысл сразу после того, как контент
 * изменился (или подтверждённо НЕ изменился — это признак, что список устоялся). Отдельная
 * петля повторяла бы выборку и расходилась бы с уходом по времени.
 *
 * Стоимость: 3 вызова модели на список, поэтому в режиме 'off' (дефолт) не тратится ничего —
 * ни линз, ни проверки ссылок.
 */
export async function gateOwnDraft(
  tpl: { id: string; slug: string; tags: string[]; desc: unknown; status: string | null; living?: boolean; freshestAgeDays?: number },
  snapshot: ReadinessInput,
  ctx: { tenderId: string; agentId: string; policyVersion: number; lang: Lang },
): Promise<'published' | 'held' | 'skipped'> {
  const settings = await getAiSettings()
  const bar: ReadinessBar = { ...DEFAULT_BAR, mode: settings.readinessMode, minSteps: settings.readinessMinSteps, minGrade: settings.readinessMinGrade }
  if (bar.mode === 'off') return 'skipped'
  // Линзы — платные: тот же per-item предохранитель, что в самогенерации.
  if (!(await globalBudgetOk())) return 'skipped'

  // Мёртвые ссылки считаем по ФИНАЛЬНОМУ содержимому: refine мог их заменить, и планка
  // должна судить то, что публикуется, а не то, что было до правки.
  const urls = snapshot.items.flatMap((it) => it.refs?.map((r) => r.url) ?? []).filter(Boolean)
  const verdictsByUrl = urls.length ? await checkUrls(urls) : new Map<string, string>()
  const deadLinks = [...verdictsByUrl.values()].filter((v) => v === 'dead').length
  // Класс полноты считаем ЗДЕСЬ же, по тем же пунктам: одна поездка по данным, один портрет
  // списка. Он и в блокеры пойдёт, и в журнал — чтобы видно было, куда список дорос.
  const verdict = gradeList(featuresOf(snapshot.items, deadLinks))
  const facts: ReadinessFacts = {
    steps: snapshot.items.length,
    deadLinks,
    hasDesc: !!snapshot.desc.trim(),
    hasTags: snapshot.tags.length > 0,
    duplicateSteps: countDuplicateSteps(snapshot.items.map((it) => it.title)),
    grade: verdict.grade,
    gradeNext: verdict.next,
    // Ленту планка судит свежестью вместо класса: класс мерит «полон ли список навсегда», а
    // лента полной не бывает. Возраст материала считает вызывающий — у него список целиком.
    living: tpl.living,
    freshestAgeDays: tpl.freshestAgeDays,
  }

  // Структурные блокеры — кодом и БЕСПЛАТНО: если список не дотягивает по ним, линзы не
  // зовём вовсе (нет смысла платить за мнение о списке из двух шагов).
  const structural = structuralBlockers(facts, bar)
  const verdicts = structural.length ? [] : await runReadinessLenses(snapshot, { userId: ctx.tenderId, refId: tpl.id })
  const decision = readinessDecision(facts, verdicts, bar)

  // КАНАРЕЙКА: даже пройденная планка не даёт публиковать больше суточной квоты. Это не
  // ошибка и не срыв предохранителя — просто дальше ждём человека.
  const quotaLeft = decision.publish ? await publishQuotaLeft('gardener', settings.readinessPerDay) : 0
  if (decision.publish && quotaLeft <= 0) {
    decision.publish = false
    decision.blockers.push(`суточная квота автопубликаций исчерпана (${settings.readinessPerDay})`)
  }

  if (decision.publish) {
    await db.update(templates).set({ status: 'published', updatedAt: new Date() }).where(eq(templates.id, tpl.id))
    // Публикация компании проходит МОДЕРАЦИЮ как любая другая: гейт готовности решает
    // «готово ли», модерация — «безопасно ли показывать». Смешивать эти вопросы нельзя.
    await moderateNewPublication(tpl.id)
    await enqueueReindex(tpl.id)
  }

  await recordAgentAction({
    loop: 'gardener',
    action: decision.publish ? 'list.publish' : 'list.hold',
    resultStatus: decision.publish ? 'ok' : 'skipped',
    agentId: ctx.agentId,
    actorUserId: ctx.tenderId,
    signal: { templateId: tpl.id, slug: tpl.slug, ...facts, gradeReasons: verdict.reasons },
    decision: {
      mode: bar.mode,
      wouldPass: decision.wouldPass,
      blockers: decision.blockers,
      lenses: decision.verdicts.map((v) => `${v.lens}:${v.answer}`),
    },
    resultRef: tpl.slug,
    policyVersion: ctx.policyVersion,
  })
  log.info('gardener: readiness gate', { slug: tpl.slug, mode: bar.mode, wouldPass: decision.wouldPass, blockers: decision.blockers.length })
  return decision.publish ? 'published' : 'held'
}
