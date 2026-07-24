import 'server-only'
import { and, eq, sql } from 'drizzle-orm'
import { db, issues, linkChecks, linkOccurrences, templates } from '@/shared/db'
import { dominantLang } from '@/shared/ai/gardener-policies'
import { t, type LocaleText } from '@/shared/i18n'
import { getLinkcheckSettings } from '@/shared/settings/linkcheck'
import { log } from '@/shared/observability'
// eslint-disable-next-line boundaries/dependencies -- сервисный аккаунт садовника = автор issue
import { ensureGardenerUser } from '@/features/gardener/service'
// eslint-disable-next-line boundaries/dependencies -- открытие issue через канонический порт CollabStore
import { collabStore } from '@/features/collab-store/store'
// eslint-disable-next-line boundaries/dependencies -- уведомить владельца о доставке (как обычный issue_new)
import { notifyMany } from '@/features/notifications/notify'
// eslint-disable-next-line boundaries/dependencies -- список подписчиков issues списка
import { getWatcherIds } from '@/features/watch/queries'

// Ж1b «живые списки»: доставка результата link-checker'а. По накопленным
// verdict='broken' садовник открывает ОДИН открытый issue на список с перечнем
// мёртвых ссылок и подсказкой archive.org. 0 токенов (никакого ИИ).
//
// Доставляем ТОЛЬКО 'broken' (подтверждённые 404/410 за brokenFails свипов).
// 'unreachable'/'uncheckable' (geo-блок ТСПУ, бот-защита с RU-сервера) владельцу
// НЕ показываем — это шум, а не мёртвая ссылка; они уходят лишь в админ-сводку.

const BROKEN_LABEL = 'broken-link'
const MAX_URLS = 30 // не раздуваем issue; хвост сворачиваем в «…и ещё N»

/** Ссылка на все снимки страницы в Wayback Machine (всегда валидна). */
const wayback = (url: string): string => `https://web.archive.org/web/*/${url}`

/**
 * Открыть issue про битые ссылки на каждом затронутом публичном списке.
 * Идемпотентно: пока висит открытый issue садовника с меткой broken-link —
 * новый не открываем (дедуп). Возвращает число открытых issue.
 */
export async function deliverBrokenLinks(): Promise<{ opened: number }> {
  const s = await getLinkcheckSettings()
  if (!s.deliverIssues) return { opened: 0 }

  // Битые ссылки, реально присутствующие в контенте активных публичных списков.
  // link_occurrences свежий — харвест пересобирает его в голове свипа до доставки.
  const rows = await db
    .select({
      templateId: linkOccurrences.templateId,
      ownerId: templates.ownerId,
      title: templates.title,
      urlNorm: linkChecks.urlNorm,
    })
    .from(linkChecks)
    .innerJoin(linkOccurrences, eq(linkOccurrences.urlNorm, linkChecks.urlNorm))
    .innerJoin(templates, eq(templates.id, linkOccurrences.templateId))
    .where(
      and(
        eq(linkChecks.verdict, 'broken'),
        eq(templates.status, 'published'),
        eq(templates.visibility, 'public'),
        eq(templates.moderation, 'active'),
        // Архивные/замороженные списки не трогаем (как и садовник).
        sql`${templates.archivedAt} is null and ${templates.frozenAt} is null`,
      ),
    )
  if (!rows.length) return { opened: 0 }

  // Группируем по списку → уникальные битые URL.
  const byTemplate = new Map<string, { ownerId: string; title: LocaleText | null; urls: Set<string> }>()
  for (const r of rows) {
    let g = byTemplate.get(r.templateId)
    if (!g) {
      g = { ownerId: r.ownerId, title: r.title, urls: new Set() }
      byTemplate.set(r.templateId, g)
    }
    g.urls.add(r.urlNorm)
  }

  const gardener = await ensureGardenerUser()
  let opened = 0
  for (const [templateId, g] of byTemplate) {
    // Дедуп: уже есть открытый issue садовника про битые ссылки — не плодим.
    const [dupe] = await db
      .select({ id: issues.id })
      .from(issues)
      .where(
        and(
          eq(issues.templateId, templateId),
          eq(issues.authorId, gardener.id),
          eq(issues.status, 'open'),
          sql`${issues.labels} @> ${JSON.stringify([BROKEN_LABEL])}::jsonb`,
        ),
      )
      .limit(1)
    if (dupe) continue

    // Issue пишем на языке списка (по заголовку) — как и правки садовника.
    const lang = dominantLang([g.title])
    const urls = [...g.urls]
    const shown = urls.slice(0, MAX_URLS)
    const archive = t('gardenerIssueBrokenArchive', lang)
    const lines = shown.map((u) => `- ${u} — [${archive}](${wayback(u)})`)
    if (urls.length > MAX_URLS) {
      lines.push(t('gardenerIssueBrokenMore', lang).replace('{n}', String(urls.length - MAX_URLS)))
    }
    const title = t('gardenerIssueBrokenTitle', lang).replace('{n}', String(urls.length))
    const body = `${t('gardenerIssueBrokenIntro', lang)}\n\n${lines.join('\n')}`

    const iss = await collabStore.openIssue(templateId, gardener.id, title, body, [BROKEN_LABEL])
    const watchers = await getWatcherIds(templateId, 'issues')
    await notifyMany([g.ownerId, ...watchers], { actorId: gardener.id, type: 'issue_new', templateId })
    opened++
    log.info('linkcheck: broken-link issue opened', { templateId, issue: iss.number, urls: urls.length })
  }
  if (opened) log.info('linkcheck deliver done', { opened })
  return { opened }
}
