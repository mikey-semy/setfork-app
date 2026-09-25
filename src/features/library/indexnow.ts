import 'server-only'
import { and, asc, eq, gt, isNull, ne, not, or, sql } from 'drizzle-orm'
import { db, indexnowSubmissions, jobs, templates, users } from '@/shared/db'
import { enqueueJob } from '@/shared/jobs/queue'
import { cursorKey } from '@/shared/db/keyset'
import { isLang } from '@/shared/i18n'
import { appOrigin } from '@/shared/auth/app-origin'
import { botUserAgent } from '@/shared/site'
import { getSettings, saveSettings } from '@/shared/settings/kv'
import { indexNowKey, indexNowKeyPath } from '@/shared/indexnow'
import { log } from '@/shared/observability'
import { loopPolicy, recordAgentAction } from '@/shared/agents/policy'
import { autonomyHealthy } from '@/shared/agents/canary'
import { indexableFilter } from './queries/shared'

/**
 * INDEXNOW — сообщать поисковикам о новых версиях публичных списков.
 *
 * Яндекс, Bing и остальные участники протокола узнают о правке сразу, не дожидаясь робота
 * (Google протокол не поддерживает). Главная цель — Яндекс.
 *
 * ⚠️ ПРОХОД, А НЕ ВЫЗОВ ПРИ ПУБЛИКАЦИИ. Версию публикуют больше шести путей, и вызов на
 * каждом — корень «забыли один путь». Проход раз в `PASS_EVERY_MIN` ловит все сразу. Что
 * уже отправлено и КАКИМ адресом — строка на список (`indexnow_submissions`); почему не
 * одна отметка времени — в схеме.
 *
 * ⚠️ ОТПРАВЛЯЕТСЯ ТОЛЬКО ИНДЕКСИРУЕМОЕ — `indexableFilter()`, то же правило, что у карты
 * сайта и llms.txt (сейчас это публичная видимость). Адрес черновика или приватного
 * списка раскрывал бы слаг. Исключение одно и безопасное: список, который БЫЛ отправлен
 * и перестал быть индексируемым, сообщается ещё раз — протокол велит сообщать и об
 * удалённом, а строка отправки доказывает, что адрес уже был публичным, то есть ничего
 * нового он не раскрывает. Поисковик перепроверит адрес и уберёт его из выдачи раньше
 * обычного обхода — это в пользу приватности. Удалённый совсем (каскад снёс строку) не
 * сообщается: робот сам увидит 404.
 *
 * ⚠️ АДРЕСА — ОТ `appOrigin()`, не от запроса: проход идёт в воркере, запроса нет вовсе, а
 * хост в теле обязан совпасть с хостом адресов (иначе 422). Корень K15, setfork-app#968.
 *
 * ⚠️ ОДНА ПАЧКА ЗА ПРОХОД. Протокол просит сообщать по мере изменений, а не выгружать
 * корпус разом; первый проход на проде иначе ушёл бы очередью пачек подряд. Пачка до
 * потолка протокола, остаток — следующими проходами, раз в четверть часа.
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
 * Отступ после отказа, который повтор не лечит (400/403/422 и неверный файл ключа: формат,
 * ключ, хост). Это ошибка настройки, её чинит человек; долбить приёмник каждые 15 минут
 * бессмысленно. Раз в шесть часов — чтобы починенный ключ подхватился в тот же день.
 */
const CONFIG_ERROR_BACKOFF_MS = 6 * 3_600_000
/**
 * Отступ после 429. Протокол называет этот ответ «potential spam»: повтор через четверть
 * часа той же пачкой подтверждал бы подозрение. Час — четыре пропущенных прохода.
 */
const RATE_LIMIT_BACKOFF_MS = 3_600_000

export const INDEXNOW_KEYS = {
  /** До какого момента проход молчит после отказа (ISO). */
  backoffUntil: 'indexnow.backoff_until',
} as const

/**
 * Языки, чьи адреса сейчас уходят, — строкой для сравнения с отправленным. Пусто: языка в
 * адресе нет (ADR-0029, 25.09.2026). С 22 по 25.09 уходили ещё `/ru/…` и `/en/…` — у таких
 * строк `sent_langs` = `en,ru`, и расхождение с этим значением само отправит их ещё раз:
 * новый адрес и прежние языковые, на которых поисковик увидит перенаправление.
 */
export const CURRENT_LANGS = ''

/** Адрес страницы списка — один на все языки; последним, как и раньше, идёт он. */
export function listUrls(handle: string, slug: string, origin: string): string[] {
  return [`${origin}/${handle}/${slug}`]
}

/** Адреса, отправленные раньше: сохранённый адрес и, если были, его языковые варианты ТОГО момента. */
export function sentUrls(sentUrl: string, sentLangs: string): string[] {
  const { origin, pathname } = new URL(sentUrl)
  const langs = sentLangs.split(',').filter(isLang)
  return [...langs.map((code) => `${origin}/${code}${pathname}`), sentUrl]
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
      headers: { 'content-type': 'application/json; charset=utf-8', 'user-agent': botUserAgent('indexnow') },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
    // Тело не нужно, но без чтения соединение держится до сборки мусора.
    await res.body?.cancel().catch(() => {})
    return res.status
  } catch {
    return 0
  }
}

/**
 * Свой файл ключа — глазами поисковика: по публичному адресу, БЕЗ перехода по редиректам.
 * Неверный хост в `APP_URL` (например, адрес с 301 на канон) обнаружится здесь, до
 * отправки, а не молчаливым выбрасыванием пачки после ответа 202 «ключ проверяется».
 *
 * `true` — ключ на месте; `false` — точно не на месте (ответ есть, но не тот); `null` —
 * проверить не удалось (сеть). На `null` отправка идёт: сбой нашей сети до самих себя —
 * не повод выключать сообщение поисковикам, которые до нас достают.
 */
export type CheckKeyFn = (origin: string, key: string) => Promise<boolean | null>

export const checkKeyFile: CheckKeyFn = async (origin, key) => {
  try {
    const res = await fetch(`${origin}${indexNowKeyPath(key)}`, {
      redirect: 'manual',
      headers: { 'user-agent': botUserAgent('indexnow') },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
    return res.status === 200 && (await res.text()).trim() === key
  } catch {
    return null
  }
}

/** 200 — принято; 202 — принято, ключ ещё проверяется. Остальное — не принято. */
const accepted = (status: number) => status === 200 || status === 202
/** Отказ, который повтор не вылечит: формат, ключ, хост (400/403/422). */
const configError = (status: number) => status === 400 || status === 403 || status === 422

export interface PassResult {
  status: 'off' | 'tripped' | 'backoff' | 'dry-run' | 'ok' | 'retry' | 'config-error'
  sentLists: number
  withdrawnLists: number
  sentUrls: number
  lastStatus?: number
}

/**
 * Один проход — одна пачка. Сначала снятые с публичности (убрать из выдачи важнее), затем
 * новые и изменённые, пока влезает в потолок. Пометки — только после принятого ответа.
 */
export async function runIndexNowPass(send: SendFn = postIndexNow, now: Date = new Date(), checkKey: CheckKeyFn = checkKeyFile): Promise<PassResult> {
  const result: PassResult = { status: 'ok', sentLists: 0, withdrawnLists: 0, sentUrls: 0 }
  const key = indexNowKey()
  if (!key) {
    // Задан, но не по правилам протокола — не молчать: владелец задал ключ и ждёт, что
    // IndexNow работает. Ошибка в журнале видна в админке, серия срывает предохранитель.
    if (process.env.INDEXNOW_KEY?.trim()) {
      log.error('indexnow: INDEXNOW_KEY is set but invalid (8–128 chars of a-z, A-Z, 0-9, "-")')
      await recordAgentAction({ loop: 'indexnow', action: 'indexnow.submit', resultStatus: 'error', error: 'INDEXNOW_KEY is invalid' })
    }
    return { ...result, status: 'off' }
  }
  // Общий предохранитель петель: серия ошибок подряд останавливает петлю до человека.
  if (!(await autonomyHealthy('indexnow'))) return { ...result, status: 'tripped' }

  const backoff = (await getSettings([INDEXNOW_KEYS.backoffUntil]))[INDEXNOW_KEYS.backoffUntil]
  if (backoff && new Date(backoff) > now) return { ...result, status: 'backoff' }

  const origin = appOrigin()
  const host = new URL(origin).host
  const keyLocation = `${origin}${indexNowKeyPath(key)}`
  // Сколько адресов у списка — из того же правила, что строит адреса, а не числом.
  const rowsCap = Math.floor(MAX_URLS_PER_REQUEST / listUrls('h', 's', origin).length)
  // Текущий адрес без префикса — той же формы, что `listUrls(…).at(-1)`: сравнивается с отправленным.
  const currentUrl = sql<string>`${origin} || '/' || ${users.handle} || '/' || ${templates.slug}`

  const withdrawn = await db
    .select({ id: indexnowSubmissions.templateId, sentUrl: indexnowSubmissions.sentUrl, sentLangs: indexnowSubmissions.sentLangs })
    .from(indexnowSubmissions)
    .innerJoin(templates, eq(templates.id, indexnowSubmissions.templateId))
    .where(not(indexableFilter()))
    .orderBy(asc(indexnowSubmissions.sentAt))
    .limit(rowsCap)
  const fresh = await db
    .select({
      id: templates.id,
      handle: users.handle,
      slug: templates.slug,
      updatedAtText: cursorKey(templates.updatedAt),
      sentUrl: indexnowSubmissions.sentUrl,
      sentLangs: indexnowSubmissions.sentLangs,
    })
    .from(templates)
    .innerJoin(users, eq(users.id, templates.ownerId))
    .leftJoin(indexnowSubmissions, eq(indexnowSubmissions.templateId, templates.id))
    .where(
      and(
        indexableFilter(),
        or(
          isNull(indexnowSubmissions.templateId),
          gt(templates.updatedAt, indexnowSubmissions.sentUpdatedAt),
          ne(indexnowSubmissions.sentUrl, currentUrl),
          ne(indexnowSubmissions.sentLangs, CURRENT_LANGS),
        ),
      ),
    )
    .orderBy(asc(templates.updatedAt), asc(templates.id))
    .limit(rowsCap)

  // Набираем пачку до потолка: снятые первыми, затем новые и изменённые.
  const urlList: string[] = []
  const fits = (urls: string[]) => urlList.length + urls.length <= MAX_URLS_PER_REQUEST
  const takenWithdrawn: string[] = []
  for (const w of withdrawn) {
    const urls = sentUrls(w.sentUrl, w.sentLangs)
    if (!fits(urls)) break
    urlList.push(...urls)
    takenWithdrawn.push(w.id)
  }
  const takenFresh: { id: string; updatedAtText: string; url: string }[] = []
  for (const f of fresh) {
    const urls = listUrls(f.handle, f.slug, origin)
    const url = urls[urls.length - 1]
    // Адрес сменился (ник, хост) или ушли языковые адреса — прежние адреса тоже: поисковик
    // увидит там перенаправление. Совпадающий с нынешним адрес дважды не шлём.
    const moved =
      f.sentUrl && (f.sentUrl !== url || (f.sentLangs ?? '') !== CURRENT_LANGS)
        ? sentUrls(f.sentUrl, f.sentLangs ?? '').filter((u) => !urls.includes(u))
        : []
    if (!fits([...urls, ...moved])) break
    urlList.push(...urls, ...moved)
    takenFresh.push({ id: f.id, updatedAtText: f.updatedAtText, url })
  }
  // Отправлять нечего — в журнал не пишем. Запись `skipped` каждые 15 минут через три часа
  // заполнила бы окно детектора холостого хода (12 записей), где прогресс — только `ok`, и
  // тихий сайт, которому просто нечего отправлять, числился бы застрявшим.
  if (!urlList.length) return result

  const loop = await loopPolicy('indexnow')
  const signal = { lists: takenFresh.length, withdrawn: takenWithdrawn.length, urls: urlList.length }
  if (loop.dryRun) {
    // Сухой прогон: посчитать и записать, не отправляя и НЕ помечая.
    await recordAgentAction({ loop: 'indexnow', action: 'indexnow.submit', resultStatus: 'dry-run', signal, policyVersion: loop.policyVersion })
    return { ...result, status: 'dry-run' }
  }

  const fail = async (status: PassResult['status'], backoffMs: number | null, error: string): Promise<PassResult> => {
    if (backoffMs) await saveSettings({ [INDEXNOW_KEYS.backoffUntil]: new Date(now.getTime() + backoffMs).toISOString() })
    await recordAgentAction({ loop: 'indexnow', action: 'indexnow.submit', resultStatus: 'error', signal, error, decision: { lastStatus: result.lastStatus ?? null }, policyVersion: loop.policyVersion })
    return { ...result, status }
  }

  if ((await checkKey(origin, key)) === false) {
    log.error('indexnow: key file is not served at keyLocation — check APP_URL and INDEXNOW_KEY', { keyLocation })
    return fail('config-error', CONFIG_ERROR_BACKOFF_MS, `key file not served at ${keyLocation}`)
  }

  const status = await send({ host, key, keyLocation, urlList })
  result.lastStatus = status
  if (!accepted(status)) {
    if (configError(status)) {
      // Повтор не поможет — ждать человека, а не долбить приёмник.
      log.error('indexnow rejected: check INDEXNOW_KEY and the key file', { status, host, keyLocation })
      return fail('config-error', CONFIG_ERROR_BACKOFF_MS, `rejected with ${status}`)
    }
    // 429 — отступ; 5xx и сеть — повтор следующим проходом. Пометок нет ни там, ни там.
    log.warn('indexnow not accepted, will retry', { status })
    return fail('retry', status === 429 ? RATE_LIMIT_BACKOFF_MS : null, `not accepted: ${status}`)
  }

  await db.transaction(async (tx) => {
    if (takenFresh.length) {
      await tx
        .insert(indexnowSubmissions)
        .values(
          takenFresh.map((f) => ({
            templateId: f.id,
            sentUpdatedAt: sql`${f.updatedAtText}::timestamptz` as unknown as Date,
            sentUrl: f.url,
            sentLangs: CURRENT_LANGS,
          })),
        )
        .onConflictDoUpdate({
          target: indexnowSubmissions.templateId,
          set: {
            // GREATEST: два прохода разом (два экземпляра на старте) не откатят пометку назад.
            sentUpdatedAt: sql`greatest(${indexnowSubmissions.sentUpdatedAt}, excluded.sent_updated_at)`,
            sentUrl: sql`excluded.sent_url`,
            sentLangs: sql`excluded.sent_langs`,
            sentAt: sql`now()`,
          },
        })
    }
    // Снятый с публичности сообщён — строку долой: откроют снова — уйдёт как новый.
    for (const id of takenWithdrawn) await tx.delete(indexnowSubmissions).where(eq(indexnowSubmissions.templateId, id))
  })

  result.sentLists = takenFresh.length
  result.withdrawnLists = takenWithdrawn.length
  result.sentUrls = urlList.length
  await recordAgentAction({ loop: 'indexnow', action: 'indexnow.submit', resultStatus: 'ok', signal, decision: { lastStatus: status }, policyVersion: loop.policyVersion })
  log.info('indexnow pass done', { ...signal, status })
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
