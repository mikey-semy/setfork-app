import 'server-only'
import { eq, inArray } from 'drizzle-orm'
import { db, linkChecks, suggestionReportedChecks, users } from '@/shared/db'
import { extractUrls, normalizeUrl, productItems, walkStrings } from '@/core'

// Проверки ПРАВКИ — наш аналог вкладки Checks. Наполнена тем, что у нас реально
// есть, а не пустым «как у GitHub»: CI для списка не существует, зато существуют
// конфликты слияния, устаревшая база, блокирующее ревью и вердикты ссылок.
//
// Задел на будущее (владелец): сюда же лягут actions и рецензии гномов —
// достаточно добавить пункт в список, форма ответа уже общая.

export type CheckStatus = 'ok' | 'warn' | 'fail' | 'neutral' | 'pending'

/** Статусы, которыми разрешено отчитаться снаружи. Всё прочее — отказ, а не «neutral». */
export const REPORTED_STATUSES = ['ok', 'warn', 'fail', 'neutral', 'pending'] as const
export type ReportedStatus = (typeof REPORTED_STATUSES)[number]

export interface CheckItem {
  key: string
  status: CheckStatus
  /** Короткая суть — «что проверено». Подробность — в detail. */
  title: string
  detail?: string
  /** Ссылка на подробности (лог прогона) — только у внешних проверок. */
  url?: string
  /** Кто отчитался. Пусто у своих проверок: их считает само приложение. */
  reportedBy?: string
}

/**
 * Внешние проверки предложения — то, что прислал агент или CI снаружи.
 *
 * Отдельным запросом, а не внутри suggestionChecks(): страница считает свои
 * проверки из уже загруженных данных, а эти живут в БД и нужны ещё и MCP-ответу.
 */
/**
 * Внешние проверки, мешающие слиянию: упавшие и ещё идущие.
 *
 * Отдельно от `reportedChecks()`: гейту не нужны ни подписи, ни ссылки, ни ники —
 * ему нужен ответ «можно ли», и тащить ради него весь список с join'ом по авторам
 * значило бы платить за витрину на каждом слиянии.
 *
 * Незавершённая проверка держит слияние так же, как упавшая: «ещё не прошла» — это
 * не «прошла». Иначе гейт обходился бы гонкой: слить, пока прогон не отчитался.
 */
export async function blockingReportedChecks(
  suggestionId: string,
  currentRevision?: string | null,
): Promise<{ failed: string[]; pending: string[]; stale: string[] }> {
  const rows = await db
    .select({ name: suggestionReportedChecks.name, status: suggestionReportedChecks.status, revision: suggestionReportedChecks.revision })
    .from(suggestionReportedChecks)
    .where(eq(suggestionReportedChecks.suggestionId, suggestionId))
  // Отчёт о ДРУГОЙ ревизии — это не «пройдено», а «проверяли не то». Держит слияние
  // так же, как незавершённый: иначе после зелёного отчёта достаточно дописать
  // предложение — и непроверенное уезжает в main.
  //
  // Отчёты БЕЗ ревизии (сделаны до появления поля) устаревшими не считаем: иначе
  // включение гейта задним числом заперло бы уже отчитавшиеся предложения.
  const isStale = (r: { revision: string | null }) => !!currentRevision && !!r.revision && r.revision !== currentRevision
  return {
    failed: rows.filter((r) => r.status === 'fail' && !isStale(r)).map((r) => r.name),
    pending: rows.filter((r) => r.status === 'pending' && !isStale(r)).map((r) => r.name),
    stale: rows.filter(isStale).map((r) => r.name),
  }
}

export async function reportedChecks(suggestionId: string): Promise<CheckItem[]> {
  const rows = await db
    .select({
      name: suggestionReportedChecks.name,
      status: suggestionReportedChecks.status,
      summary: suggestionReportedChecks.summary,
      url: suggestionReportedChecks.url,
      handle: users.handle,
      updatedAt: suggestionReportedChecks.updatedAt,
    })
    .from(suggestionReportedChecks)
    .leftJoin(users, eq(users.id, suggestionReportedChecks.reporterId))
    .where(eq(suggestionReportedChecks.suggestionId, suggestionId))
    .orderBy(suggestionReportedChecks.name)
  return rows.map((r) => ({
    // Префикс, чтобы внешняя проверка с именем «merge» не выдавала себя за нашу.
    key: `ext:${r.name}`,
    status: (REPORTED_STATUSES as readonly string[]).includes(r.status) ? (r.status as CheckStatus) : 'neutral',
    title: r.name,
    detail: r.summary ?? undefined,
    url: r.url ?? undefined,
    reportedBy: r.handle ?? undefined,
  }))
}

/** Ссылки в ПРЕДЛОЖЕННЫХ пунктах: те же поверхности, что харвестит linkcheck. */
function proposedUrls(items: unknown[]): string[] {
  const out: string[] = []
  const push = (raw?: string) => {
    const norm = raw ? normalizeUrl(raw) : null
    if (norm) out.push(norm)
  }
  for (const raw of items) {
    const s = (raw ?? {}) as Record<string, unknown>
    const refs = Array.isArray(s.refs) ? (s.refs as { url?: string }[]) : []
    refs.forEach((r) => push(r.url))
    const c = (s.content ?? {}) as Record<string, unknown>
    if (s.type === 'product') productItems(s.content as Record<string, unknown> | null).forEach((p) => push(p.url))
    else if (s.type === 'video' || s.type === 'file') push(typeof c.url === 'string' ? c.url : undefined)
    for (const text of walkStrings([s.desc, s.why, s.subtasks, s.type === 'text' ? c : null]))
      for (const u of extractUrls(text)) push(u)
  }
  return [...new Set(out)]
}

/**
 * Проверки правки. Сигналы, которые страница и так вычисляет (конфликты,
 * блокирующее ревью, устаревшая база), передаются аргументами — считать их
 * второй раз значило бы разойтись с тем, что показано выше.
 */
export async function suggestionChecks(input: {
  items: unknown[]
  changedCount: number
  baseVersion: number
  currentVersion: number
  hasConflicts: boolean
  branchMissing: boolean
  /** Черновик: слить нельзя, пока автор не отметил готовность. */
  draft: boolean
  blockingReview: boolean
  /** Нерешённые обсуждения на пунктах — блокируют, если так настроен список. */
  unresolvedThreads: number
  /** Настройка списка: блокировать ли слияние нерешёнными обсуждениями. */
  blockOnUnresolved: boolean
  /** Одобрений собрано / требуется по настройке (0 = не требуются). */
  approvals: number
  requiredApprovals: number
  moderation: string
  lang: 'ru' | 'en'
}): Promise<CheckItem[]> {
  const ru = input.lang === 'ru'
  const say = (r: string, e: string) => (ru ? r : e)
  const out: CheckItem[] = []

  // 1. Правка вообще что-то меняет?
  out.push(
    input.changedCount > 0
      ? { key: 'has-changes', status: 'ok', title: say('Предложение содержит изменения', 'Suggestion has changes'), detail: say(`затронуто пунктов: ${input.changedCount}`, `items touched: ${input.changedCount}`) }
      : { key: 'has-changes', status: 'fail', title: say('Изменений нет', 'No changes'), detail: say('принимать нечего', 'nothing to accept') },
  )

  // 2. Черновик — блокирующий по определению: правка ещё не предъявлена.
  if (input.draft) {
    out.push({
      key: 'draft',
      status: 'fail',
      title: say('Пока черновик', 'Still a draft'),
      detail: say('слить нельзя, пока не отмечена готовность', 'cannot merge until marked ready'),
    })
  }

  // 3. Слияние: конфликты и пропавшая ветка — блокирующие.
  if (input.branchMissing) {
    out.push({ key: 'branch', status: 'fail', title: say('Ветка удалена', 'Branch deleted'), detail: say('предложение неактуально, можно только отклонить', 'the suggestion is stale and can only be closed') })
  } else if (input.hasConflicts) {
    out.push({ key: 'merge', status: 'fail', title: say('Конфликты слияния', 'Merge conflicts'), detail: say('нужно разрешить перед принятием', 'must be resolved before accepting') })
  } else {
    out.push({ key: 'merge', status: 'ok', title: say('Слияние без конфликтов', 'Merges cleanly') })
  }

  // 4. База правки. Не ошибка, но принятие перезапишет более новое.
  if (input.currentVersion > input.baseVersion) {
    out.push({
      key: 'base',
      status: 'warn',
      title: say('База устарела', 'Base is outdated'),
      detail: say(`предложение на v${input.baseVersion}, список уже на v${input.currentVersion}`, `based on v${input.baseVersion}, list is at v${input.currentVersion}`),
    })
  } else {
    out.push({ key: 'base', status: 'ok', title: say('База актуальна', 'Base is current') })
  }

  // 5. Ревью, запросившее правки, блокирует принятие — то же определение, что у гейта.
  out.push(
    input.blockingReview
      ? { key: 'review', status: 'fail', title: say('Запрошены правки', 'Changes requested'), detail: say('принятие заблокировано до смены вердикта', 'accepting is blocked until the verdict changes') }
      : { key: 'review', status: 'ok', title: say('Блокирующих ревью нет', 'No blocking reviews') },
  )

  // 6. Нерешённые обсуждения на пунктах. Блокируют, только если так настроен
  //    список: иначе выключенная настройка всё равно красила бы проверку красным.
  out.push(
    input.unresolvedThreads > 0
      ? {
          key: 'threads',
          status: input.blockOnUnresolved ? 'fail' : 'warn',
          title: say(`Нерешённых обсуждений: ${input.unresolvedThreads}`, `Unresolved conversations: ${input.unresolvedThreads}`),
          detail: input.blockOnUnresolved
            ? say('закройте их или отметьте решёнными', 'close them or mark them resolved')
            : say('слияние не блокируют — так настроен список', 'they do not block merging — per list settings'),
        }
      : { key: 'threads', status: 'ok', title: say('Все обсуждения решены', 'All conversations resolved') },
  )

  // 6б. Требуемые одобрения — тот же гейт, что у экшена слияния.
  if (input.requiredApprovals > 0) {
    const enough = input.approvals >= input.requiredApprovals
    out.push({
      key: 'approvals',
      status: enough ? 'ok' : 'fail',
      title: say(`Одобрений: ${input.approvals} из ${input.requiredApprovals}`, `Approvals: ${input.approvals} of ${input.requiredApprovals}`),
      detail: enough ? undefined : say('нужны одобрения рецензентов', 'reviewer approvals are required'),
    })
  }

  // 7. Модерация списка: во flagged/hidden принимать правку бессмысленно.
  if (input.moderation === 'flagged' || input.moderation === 'hidden') {
    out.push({ key: 'moderation', status: 'fail', title: say('Список снят модерацией', 'List is taken down'), detail: input.moderation })
  } else if (input.moderation === 'pending') {
    out.push({ key: 'moderation', status: 'warn', title: say('Список на проверке', 'List is under review') })
  }

  // 8. Ссылки в предложенных пунктах — по уже собранным вердиктам linkcheck.
  const urls = proposedUrls(input.items)
  if (urls.length === 0) {
    out.push({ key: 'links', status: 'neutral', title: say('Ссылок в предложении нет', 'No links in this suggestion') })
  } else {
    const rows = await db
      .select({ urlNorm: linkChecks.urlNorm, verdict: linkChecks.verdict })
      .from(linkChecks)
      .where(inArray(linkChecks.urlNorm, urls.slice(0, 200)))
    const bad = rows.filter((r) => r.verdict === 'broken' || r.verdict === 'unreachable')
    const unchecked = urls.length - rows.filter((r) => r.verdict).length
    out.push(
      bad.length > 0
        ? { key: 'links', status: 'fail', title: say(`Битых ссылок: ${bad.length}`, `Broken links: ${bad.length}`), detail: bad.slice(0, 3).map((b) => b.urlNorm).join(', ') }
        : {
            key: 'links',
            status: unchecked > 0 ? 'warn' : 'ok',
            title: say(`Ссылок проверено: ${urls.length - unchecked} из ${urls.length}`, `Links checked: ${urls.length - unchecked} of ${urls.length}`),
            detail: unchecked > 0 ? say('остальные ещё в очереди проверки', 'the rest are queued for checking') : undefined,
          },
    )
  }

  return out
}
