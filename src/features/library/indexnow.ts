import 'server-only'
import { and, asc, eq, gt, isNull, or, sql } from 'drizzle-orm'
import { db, indexnowSubmissions, jobs, templates, users } from '@/shared/db'
import { enqueueJob } from '@/shared/jobs/queue'
import { cursorKey } from '@/shared/db/keyset'
import { langAlternates } from '@/shared/i18n/url'
import { appOrigin } from '@/shared/auth/app-origin'
import { getSettings, saveSettings } from '@/shared/settings/kv'
import { indexNowKey, indexNowKeyPath } from '@/shared/indexnow'
import { log } from '@/shared/observability'
import { loopPolicy, recordAgentAction } from '@/shared/agents/policy'
import { indexableFilter } from './queries/shared'

/**
 * INDEXNOW — сообщать поисковикам о новых версиях публичных списков.
 *
 * Яндекс, Bing и остальные участники протокола узнают о правке сразу, не дожидаясь робота
 * (Google протокол не поддерживает). Главная цель — Яндекс и адреса `/ru/…`.
 *
 * ⚠️ ПРОХОД, А НЕ ВЫЗОВ ПРИ ПУБЛИКАЦИИ. Версию публикуют больше шести путей, и вызов на
 * каждом — корень «забыли один путь». Проход раз в `PASS_EVERY_MIN` ловит все сразу.
 * Что уже отправлено — строка на список (`indexnow_submissions`), а не одна отметка
 * времени: почему — в схеме.
 *
 * ⚠️ ОТПРАВЛЯЕТСЯ ТОЛЬКО ИНДЕКСИРУЕМОЕ — `indexableFilter()`, то же правило, что у карты
 * сайта и llms.txt (сейчас это публичная видимость). Адрес черновика или приватного
 * списка раскрывал бы слаг; одно правило на все машинные выходы не даёт им разойтись.
 * Удалённые и скрытые не сообщаются: робот сам увидит 404.
 *
 * ⚠️ АДРЕСА — ОТ `appOrigin()`, не от запроса: проход идёт в воркере, запроса нет вовсе, а
 * хост в теле обязан совпасть с хостом адресов (иначе 422). Корень K15, setfork-app#968.
 */

/** Точка приёма общая: участники протокола пересылают пачку друг другу. */
const ENDPOINT = 'https://api.indexnow.org/indexnow'
/** Потолок пачки по спецификации — «up to 10,000 URLs». */
export const MAX_URLS_PER_REQUEST = 10_000
/** Ритм прохода — из задания: свежая версия у поисковика в пределах четверти часа. */
const PASS_EVERY_MIN = 15
/**
 * Дедлайн запроса. Без него зависший приёмник держал бы задачу воркера бесконечно
 * (урок линзы 08 на fe#975). Полминуты — с запасом на пачку в десять тысяч адресов.
 */
const REQUEST_TIMEOUT_MS = 30_000
/**
 * Отступ после отказа, который повтор не лечит (400/403/422: формат, ключ, хост). Это
 * ошибка настройки, её чинит человек; долбить приёмник каждые 15 минут бессмысленно и
 * невежливо. Раз в шесть часов — чтобы починенный ключ подхватился в тот же день.
 */
const CONFIG_ERROR_BACKOFF_MS = 6 * 3_600_000

export const INDEXNOW_KEYS = {
  /** До какого момента проход молчит после отказа настройки (ISO). */
  backoffUntil: 'indexnow.backoff_until',
} as const

/** Все адреса страницы списка: по одному на язык и адрес без префикса (`x-default`). */
export function listUrls(handle: string, slug: string, origin: string): string[] {
  const { languages, xDefault } = langAlternates(`/${handle}/${slug}`, origin)
  return [...Object.values(languages), xDefault]
}

export interface IndexNowBody {
  host: string
  key: string
  keyLocation: string
  urlList: string[]
}

/** Отправка пачки: код ответа, 0 — сеть или дедлайн. Инжектируется в тестах: сети там нет. */
export type SendFn = (body: IndexNowBody) => Promise<number>

export const postIndexNow: SendFn = async (body) => {
  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json; charset=utf-8' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
    return res.status
  } catch {
    return 0
  }
}

/** 200 — принято; 202 — принято, ключ ещё проверяется. Остальное — не принято. */
const accepted = (status: number) => status === 200 || status === 202
/** Отказ, который повтор не вылечит: формат, ключ, хост (400/403/422). */
const configError = (status: number) => status === 400 || status === 403 || status === 422

export interface PassResult {
  status: 'off' | 'backoff' | 'dry-run' | 'ok' | 'retry' | 'config-error'
  sentLists: number
  sentUrls: number
  lastStatus?: number
}

/**
 * Один проход. Порциями по столько списков, сколько адресов влезает в одну пачку:
 * отправленная порция помечается и выпадает из выборки, следующая берёт остаток.
 * Остановка — на первом непринятом ответе: неотмеченное повторит следующий проход.
 */
export async function runIndexNowPass(send: SendFn = postIndexNow, now: Date = new Date()): Promise<PassResult> {
  const key = indexNowKey()
  if (!key) return { status: 'off', sentLists: 0, sentUrls: 0 }
  const result: PassResult = { status: 'ok', sentLists: 0, sentUrls: 0 }

  const backoff = (await getSettings([INDEXNOW_KEYS.backoffUntil]))[INDEXNOW_KEYS.backoffUntil]
  if (backoff && new Date(backoff) > now) return { ...result, status: 'backoff' }

  const origin = appOrigin()
  const host = new URL(origin).host
  const keyLocation = `${origin}${indexNowKeyPath(key)}`
  // Сколько адресов у одного списка — из того же правила, что строит адреса, а не числом.
  const perList = listUrls('h', 's', origin).length
  const listsPerRequest = Math.floor(MAX_URLS_PER_REQUEST / perList)
  const loop = await loopPolicy('indexnow')

  for (;;) {
    const rows = await db
      .select({ id: templates.id, handle: users.handle, slug: templates.slug, updatedAtText: cursorKey(templates.updatedAt) })
      .from(templates)
      .innerJoin(users, eq(users.id, templates.ownerId))
      .leftJoin(indexnowSubmissions, eq(indexnowSubmissions.templateId, templates.id))
      .where(and(indexableFilter(), or(isNull(indexnowSubmissions.templateId), gt(templates.updatedAt, indexnowSubmissions.sentUpdatedAt))))
      .orderBy(asc(templates.updatedAt), asc(templates.id))
      .limit(listsPerRequest)
    if (!rows.length) break

    const urlList = rows.flatMap((r) => listUrls(r.handle, r.slug, origin))
    // Сухой прогон: посчитать и записать, не отправляя и не помечая. Одна порция — без
    // пометок следующая была бы той же самой.
    if (loop.dryRun) {
      await recordAgentAction({ loop: 'indexnow', action: 'indexnow.submit', resultStatus: 'dry-run', signal: { lists: rows.length, urls: urlList.length }, policyVersion: loop.policyVersion })
      return { ...result, status: 'dry-run' }
    }

    const status = await send({ host, key, keyLocation, urlList })
    result.lastStatus = status
    if (!accepted(status)) {
      if (configError(status)) {
        // Повтор не поможет — ждать человека, а не долбить приёмник.
        await saveSettings({ [INDEXNOW_KEYS.backoffUntil]: new Date(now.getTime() + CONFIG_ERROR_BACKOFF_MS).toISOString() })
        log.error('indexnow rejected: check INDEXNOW_KEY and the key file', { status, host, keyLocation })
        result.status = 'config-error'
      } else {
        // 429, 5xx, сеть — пометок нет, следующий проход повторит эти же списки.
        log.warn('indexnow not accepted, will retry next pass', { status })
        result.status = 'retry'
      }
      break
    }

    await db
      .insert(indexnowSubmissions)
      .values(rows.map((r) => ({ templateId: r.id, sentUpdatedAt: sql`${r.updatedAtText}::timestamptz` as unknown as Date })))
      .onConflictDoUpdate({
        target: indexnowSubmissions.templateId,
        set: { sentUpdatedAt: sql`excluded.sent_updated_at`, sentAt: sql`now()` },
      })
    result.sentLists += rows.length
    result.sentUrls += urlList.length
    if (rows.length < listsPerRequest) break
  }

  // Пустой проход (отправлять нечего) в журнал НЕ пишется. Ритм — четверть часа, окно
  // детектора холостого хода — двенадцать записей: на тихом сайте через три часа петля
  // числилась бы холостой, хотя ей просто нечего делать. Пишется только попытка.
  if (result.status === 'ok' && !result.sentLists) return result
  await recordAgentAction({
    loop: 'indexnow',
    action: 'indexnow.submit',
    resultStatus: result.status === 'ok' ? 'ok' : 'error',
    signal: { lists: result.sentLists, urls: result.sentUrls },
    decision: { status: result.status, lastStatus: result.lastStatus ?? null },
    policyVersion: loop.policyVersion,
  })
  log.info('indexnow pass done', { ...result })
  return result
}

/**
 * Одна pending-задача — самоподдержание без cron (как у linkcheck).
 *
 * Задача ставится и без ключа: без него проход выходит сразу, ничего не отправляя (как
 * linkcheck с выключенным тумблером). Петля при этом остаётся живой частью реестра — её
 * видно в админке, её можно поставить на паузу, а ключ, заданный на сервере, начинает
 * работать без отдельного пинка. Контракт петель (`loops-contract`) требует именно этого.
 */
export async function ensureIndexNowScheduled(): Promise<void> {
  const pending = await db
    .select({ id: jobs.id })
    .from(jobs)
    .where(and(eq(jobs.type, 'indexnow'), eq(jobs.status, 'pending')))
    .limit(1)
  if (pending.length) return
  await enqueueJob('indexnow', {}, { delayMs: PASS_EVERY_MIN * 60_000, maxAttempts: 1 })
}
