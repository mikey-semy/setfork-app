import 'server-only'
import { inArray } from 'drizzle-orm'
import { db, linkChecks } from '@/shared/db'
import { extractUrls, normalizeUrl, productItems, walkStrings } from '@/core'

// Проверки ПРАВКИ — наш аналог вкладки Checks. Наполнена тем, что у нас реально
// есть, а не пустым «как у GitHub»: CI для списка не существует, зато существуют
// конфликты слияния, устаревшая база, блокирующее ревью и вердикты ссылок.
//
// Задел на будущее (владелец): сюда же лягут actions и рецензии гномов —
// достаточно добавить пункт в список, форма ответа уже общая.

export type CheckStatus = 'ok' | 'warn' | 'fail' | 'neutral'

export interface CheckItem {
  key: string
  status: CheckStatus
  /** Короткая суть — «что проверено». Подробность — в detail. */
  title: string
  detail?: string
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
  blockingReview: boolean
  moderation: string
  lang: 'ru' | 'en'
}): Promise<CheckItem[]> {
  const ru = input.lang === 'ru'
  const say = (r: string, e: string) => (ru ? r : e)
  const out: CheckItem[] = []

  // 1. Правка вообще что-то меняет?
  out.push(
    input.changedCount > 0
      ? { key: 'has-changes', status: 'ok', title: say('Правка содержит изменения', 'Suggestion has changes'), detail: say(`затронуто пунктов: ${input.changedCount}`, `items touched: ${input.changedCount}`) }
      : { key: 'has-changes', status: 'fail', title: say('Изменений нет', 'No changes'), detail: say('принимать нечего', 'nothing to accept') },
  )

  // 2. Слияние: конфликты и пропавшая ветка — блокирующие.
  if (input.branchMissing) {
    out.push({ key: 'branch', status: 'fail', title: say('Ветка удалена', 'Branch deleted'), detail: say('PR неактуален, можно только отклонить', 'the PR is stale and can only be closed') })
  } else if (input.hasConflicts) {
    out.push({ key: 'merge', status: 'fail', title: say('Конфликты слияния', 'Merge conflicts'), detail: say('нужно разрешить перед принятием', 'must be resolved before accepting') })
  } else {
    out.push({ key: 'merge', status: 'ok', title: say('Слияние без конфликтов', 'Merges cleanly') })
  }

  // 3. База правки. Не ошибка, но принятие перезапишет более новое.
  if (input.currentVersion > input.baseVersion) {
    out.push({
      key: 'base',
      status: 'warn',
      title: say('База устарела', 'Base is outdated'),
      detail: say(`правка на v${input.baseVersion}, список уже на v${input.currentVersion}`, `based on v${input.baseVersion}, list is at v${input.currentVersion}`),
    })
  } else {
    out.push({ key: 'base', status: 'ok', title: say('База актуальна', 'Base is current') })
  }

  // 4. Ревью, запросившее правки, блокирует принятие — то же определение, что у гейта.
  out.push(
    input.blockingReview
      ? { key: 'review', status: 'fail', title: say('Запрошены правки', 'Changes requested'), detail: say('принятие заблокировано до смены вердикта', 'accepting is blocked until the verdict changes') }
      : { key: 'review', status: 'ok', title: say('Блокирующих ревью нет', 'No blocking reviews') },
  )

  // 5. Модерация списка: во flagged/hidden принимать правку бессмысленно.
  if (input.moderation === 'flagged' || input.moderation === 'hidden') {
    out.push({ key: 'moderation', status: 'fail', title: say('Список снят модерацией', 'List is taken down'), detail: input.moderation })
  } else if (input.moderation === 'pending') {
    out.push({ key: 'moderation', status: 'warn', title: say('Список на проверке', 'List is under review') })
  }

  // 6. Ссылки в предложенных пунктах — по уже собранным вердиктам linkcheck.
  const urls = proposedUrls(input.items)
  if (urls.length === 0) {
    out.push({ key: 'links', status: 'neutral', title: say('Ссылок в правке нет', 'No links in this suggestion') })
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
