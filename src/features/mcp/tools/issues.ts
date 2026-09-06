import 'server-only'
import { isFeatureEnabled } from '@/core'
import { resolveListBySlug, type ResolvedList } from '@/shared/db/resolve-list'
import { decodeCursor } from '@/shared/lib/paging'
import { changeIssueStatus, commentOnIssue, openIssue, type IssueRefusal } from '@/features/issues/core'
import { getIssue, getIssueCommentsPage, getIssues, type CloseReason, type IssueSort } from '@/features/issues/queries'
import { getIssueEvents } from '@/features/issues/events'
import { mergeThread } from '@/features/issues/thread'
import { SITE_URL, mcpCanView, resolveListRefOrMoved } from './shared'

/**
 * ЗАДАЧИ ЧЕРЕЗ MCP: завести, прочитать с тредом, ответить, закрыть с исходом, найти.
 *
 * Здесь нет ни одного правила — только перевод: ссылка на список → адрес, отказ ядра →
 * фраза, результат → ответ агенту. Ворота (право писать в раздел, запертое обсуждение,
 * ЧАСТОТА, уведомления, след в ленте) живут в `features/issues/core` и одни на две
 * поверхности. Второй набор правил для агента разошёлся бы с первым — так у нас уже
 * случилось с двумя путями слияния (#888), и повторять это на разделе, куда пишет
 * программа, тем более незачем: счётчик частоты заводили ровно против циклов.
 *
 * Имена инструментов и полей взяты у СЕРВЕРА MCP САМОГО GITHUB (github/github-mcp-server,
 * pkg/github/issues.go): `add_issue_comment`, `search_issues`, а у закрытия — пара
 * `state_reason` (completed | not_planned | duplicate) и `duplicate_of`. Совпадение с
 * нашей схемой не случайно: перечень исходов мы брали оттуда же. Расхождение одно и
 * намеренное: у них create/update слиты в `issue_write` с параметром `method`, у нас на
 * каждое действие свой инструмент — так устроен весь наш сервер (`create_list`,
 * `update_list`, `merge_suggestion`), и «закрыть» с «переоткрыть» в одном вызове с
 * параметром состояния читались бы хуже, чем два глагола.
 */

/** Отказ ядра — словами, а не кодом: агент читает ответ и решает, что делать дальше. */
const REFUSAL: Record<IssueRefusal, string> = {
  empty: 'text must not be empty',
  not_found: 'not found: no such list, the issues section is off, or there is no issue with that number',
  forbidden: 'you cannot write to the issues section of this list',
  locked: 'the discussion is locked — only the list owner or a collaborator can reply',
  rate: 'too many writes in a minute — this is the same rate limit the website has; wait and retry',
  duplicate_not_found: 'no issue with that number in this list — nothing was closed',
}

/**
 * Список по ссылке агента ПЛЮС права: `resolveListRefOrMoved` отдаёт адрес, но не
 * видимость, а без неё нельзя ни прочитать приватный, ни отказать по нему.
 */
async function listByRef(ref: string): Promise<{ tpl: ResolvedList; ownerHandle: string; slug: string; movedTo: string | null } | null> {
  const found = await resolveListRefOrMoved(ref)
  if (!found) return null
  const tpl = await resolveListBySlug(found.ownerHandle, found.slug)
  return tpl ? { tpl, ownerHandle: found.ownerHandle, slug: found.slug, movedTo: found.movedTo } : null
}

/** Список для ЧТЕНИЯ задач: видимость + включённый раздел. */
async function readableList(userId: string, ref: string) {
  const found = await listByRef(ref)
  if (!found) return null
  // Выключенный раздел не отдаёт задачи вовсе — как и страница: всё, что ниже, было бы
  // чтением раздела, которого в списке нет.
  if (!isFeatureEnabled(found.tpl, 'issues')) return null
  return (await mcpCanView(found.tpl, userId)) ? found : null
}

const issueUrl = (ownerHandle: string, slug: string, number: number) => `${SITE_URL}/${ownerHandle}/${slug}/issues/${number}`

/** ЗАВЕСТИ ЗАДАЧУ в списке — своём или чужом, там же и по тем же правам, что с сайта. */
export async function mcpCreateIssue(
  userId: string,
  input: { list: string; title: string; body?: string; labels?: string[] },
) {
  const found = await listByRef(input.list)
  if (!found) return { error: 'list not found' }
  const res = await openIssue(userId, found.ownerHandle, found.slug, {
    title: input.title ?? '',
    body: input.body,
    labels: input.labels,
  })
  if (!res.ok) return { error: REFUSAL[res.reason] }
  return {
    ref: `${found.ownerHandle}/${found.slug}`,
    number: res.number,
    url: issueUrl(found.ownerHandle, found.slug, res.number),
    movedTo: found.movedTo ?? undefined,
    // Что именно изменилось: задача есть, она открыта, и о ней уже узнали люди.
    note: 'Opened — the list owner and everyone watching the list were notified.',
  }
}

/** ОТВЕТИТЬ В ТРЕДЕ. */
export async function mcpAddIssueComment(userId: string, input: { list: string; number: number; body: string }) {
  const found = await listByRef(input.list)
  if (!found) return { error: 'list not found' }
  const res = await commentOnIssue(userId, found.ownerHandle, found.slug, input.number, input.body ?? '')
  if (!res.ok) return { error: REFUSAL[res.reason] }
  return {
    ref: `${found.ownerHandle}/${found.slug}`,
    number: input.number,
    url: issueUrl(found.ownerHandle, found.slug, input.number),
    note: 'Reply posted — the author, the list owner and everyone in the thread were notified.',
  }
}

/**
 * ЗАКРЫТЬ ЗАДАЧУ С ИСХОДОМ.
 *
 * Исход обязателен, хотя в базе он и может быть пустым: «сделали» и «не будем делать»
 * выглядят одинаково — закрытым номером, — а значат противоположное, и агент, в отличие
 * от человека, никогда не «зайдёт посмотреть» и не уточнит потом. У формы на сайте выбор
 * исхода — тоже единственный путь закрытия.
 */
export async function mcpCloseIssue(
  userId: string,
  input: { list: string; number: number; stateReason: CloseReason; duplicateOf?: number },
) {
  const found = await listByRef(input.list)
  if (!found) return { error: 'list not found' }
  if (input.stateReason === 'duplicate' && !input.duplicateOf) {
    return { error: 'stateReason "duplicate" needs duplicateOf — the number of the original issue in the same list' }
  }
  if (input.duplicateOf === input.number) return { error: 'an issue cannot be a duplicate of itself' }

  const res = await changeIssueStatus(
    userId,
    found.ownerHandle,
    found.slug,
    input.number,
    'closed',
    input.stateReason,
    input.duplicateOf,
  )
  if (!res.ok) return { error: REFUSAL[res.reason] }
  return {
    ref: `${found.ownerHandle}/${found.slug}`,
    number: input.number,
    state: res.status,
    stateReason: res.closeReason,
    duplicateOf: res.duplicateOf ?? undefined,
    url: issueUrl(found.ownerHandle, found.slug, input.number),
    // «Уже была закрыта» — не то же, что «закрыл»: повторный вызов НИЧЕГО не написал и
    // никого не разбудил, и агент обязан это различать, иначе будет звать в цикле.
    changed: res.changed,
    note: res.changed
      ? 'Closed — the author and everyone in the thread were notified. The outcome stays visible in the issue timeline.'
      : `Nothing changed: the issue was already closed${res.closeReason ? ` as ${res.closeReason}` : ''}. Reopen it first if you need a different outcome.`,
  }
}

/** ПЕРЕОТКРЫТЬ ЗАДАЧУ. Исход снимается с задачи, но остаётся в её ленте. */
export async function mcpReopenIssue(userId: string, input: { list: string; number: number }) {
  const found = await listByRef(input.list)
  if (!found) return { error: 'list not found' }
  const res = await changeIssueStatus(userId, found.ownerHandle, found.slug, input.number, 'open')
  if (!res.ok) return { error: REFUSAL[res.reason] }
  return {
    ref: `${found.ownerHandle}/${found.slug}`,
    number: input.number,
    state: res.status,
    url: issueUrl(found.ownerHandle, found.slug, input.number),
    changed: res.changed,
    note: res.changed
      ? 'Reopened — the previous outcome was cleared from the issue and stays in its timeline.'
      : 'Nothing changed: the issue was already open.',
  }
}

/** ЗАДАЧА ЦЕЛИКОМ: описание, состояние и ЛЕНТА — реплики вперемешку с событиями. */
export async function mcpGetIssue(userId: string, input: { list: string; number: number; limit?: number; cursor?: string }) {
  const found = await readableList(userId, input.list)
  if (!found) return { error: 'list not found' }
  const iss = await getIssue(found.tpl.id, input.number)
  if (!iss) return { error: 'issue not found' }

  // ⚠️ ТРЕД ЛИСТАЕТСЯ, а не «берётся побольше». Предел здесь такой же, как у страницы, и
  // за ним тред не кончается: без курсора реплики после первой порции были бы недоступны
  // вовсе, сколько ни поднимай limit. Курсор — тот же непрозрачный ключ, что в адресе
  // страницы; битый разбирается в null, и мы говорим об этом, а не молча отдаём начало.
  const cursor = input.cursor ? decodeCursor(input.cursor) : null
  if (input.cursor && !cursor) return { error: 'invalid cursor — pass back the nextCursor from a previous get_issue call' }

  const limit = input.limit ?? 50
  const [{ items: comments, next }, events] = await Promise.all([
    getIssueCommentsPage(iss.id, limit, cursor),
    getIssueEvents(iss.id),
  ])
  // Порядок склейки — тот же, что на странице: событие показывается между репликами, а
  // не отдельным хвостом, иначе «закрыл» встанет после разговора, который был позже.
  // Окно честное: события до первой реплики показываются только на ПЕРВОЙ порции, после
  // последней — только на последней, иначе каждая порция повторяла бы «закрыл задачу».
  const thread = mergeThread(comments, events, { isFirst: !cursor, isLast: !next })

  return {
    ref: `${found.ownerHandle}/${found.slug}`,
    movedTo: found.movedTo ?? undefined,
    number: iss.number,
    title: iss.title,
    body: iss.body,
    state: iss.status,
    // ⚠️ ЧЕМ КОНЧИЛОСЬ — РЯДОМ С «ЗАКРЫТА», а не только строкой в ленте. Событие
    // `closed` лежит после последней реплики, то есть в длинном треде доезжает лишь до
    // ПОСЛЕДНЕЙ порции: агент три вызова подряд видел бы «закрыта» и не знал, чем.
    stateReason: iss.closeReason ?? undefined,
    duplicateOf: iss.duplicateNumber ?? undefined,
    labels: iss.labels,
    author: iss.authorHandle,
    createdAt: iss.createdAt,
    closedAt: iss.closedAt,
    // Заперто — это ответ на «почему мой ответ не проходит»: агент увидит причину до
    // попытки, а не после отказа.
    locked: iss.lockedAt ? { since: iss.lockedAt, reason: iss.lockReason } : undefined,
    url: issueUrl(found.ownerHandle, found.slug, iss.number),
    thread: thread.map((p) =>
      p.comment
        ? { kind: 'comment' as const, at: p.at, author: p.comment.authorHandle, body: p.comment.body }
        : {
            kind: 'event' as const,
            at: p.at,
            actor: p.event!.actorHandle,
            event: p.event!.kind,
            closeReason: p.event!.closeReason ?? undefined,
            lockReason: p.event!.lockReason ?? undefined,
            duplicateOf: p.event!.duplicate?.number,
            suggestion: p.event!.suggestion?.number ?? undefined,
          },
    ),
    // Тред длиннее показанного — говорим прямо и даём чем продолжить, чтобы агент не
    // принял часть за целое и не упёрся в потолок limit.
    nextCursor: next ?? undefined,
    more: next ? `${comments.length} replies shown; call get_issue again with this nextCursor for the rest` : undefined,
  }
}

/**
 * НАЙТИ ЗАДАЧУ В СПИСКЕ.
 *
 * Слова ищутся там же, где у поиска на сайте: заголовок, тело и РЕПЛИКИ (см.
 * issues/keyword) — у нас решение чаще лежит в ответе, чем в описании. Запрос целиком из
 * цифр ищется ещё и как номер.
 *
 * Состояний два, `open` и `closed`, а не три: «все сразу» на сайте не существует — там
 * две вкладки, — и обещать агенту режим, которого нет у людей, значит разойтись с ними в
 * том, что считается «списком задач».
 */
export async function mcpSearchIssues(
  userId: string,
  input: { list: string; q?: string; state?: 'open' | 'closed'; sort?: IssueSort; limit?: number },
) {
  const found = await readableList(userId, input.list)
  if (!found) return { error: 'list not found' }
  const state = input.state ?? 'open'
  const rows = await getIssues(
    found.tpl.id,
    { status: state, q: input.q, sort: input.sort },
    { limit: input.limit ?? 20 },
  )
  return {
    ref: `${found.ownerHandle}/${found.slug}`,
    movedTo: found.movedTo ?? undefined,
    state,
    count: rows.length,
    results: rows.map((r) => ({
      number: r.number,
      title: r.title,
      state: r.status,
      labels: r.labels,
      author: r.authorHandle,
      comments: r.commentCount,
      createdAt: r.createdAt,
      url: issueUrl(found.ownerHandle, found.slug, r.number),
    })),
  }
}
