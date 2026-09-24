import { STATUS_CODES } from 'node:http'
import type { RateResult } from '@/shared/rate-limit'
import { noStoreHeaders } from './cache'

/**
 * RFC 9457 «PROBLEM DETAILS» — ошибка публичного машинного адреса одним форматом.
 *
 * До него каждый адрес отказывал по-своему: `data.json` — `{"error":"not_found"}`,
 * экспорт и скилл — голым текстом «Not found», лимит — `{"error":"rate_limited"}`. Чужому
 * коду приходилось знать все три. Теперь тело — `application/problem+json`:
 *  - `type: "about:blank"` — своих типов проблем не заводим: статус HTTP и есть тип, а
 *    `title` по стандарту тогда — фраза статуса (берётся у `node:http`, не своей таблицей);
 *  - `status` дублирует код ответа — прокси его теряют, тело остаётся;
 *  - `error` — ПРЕЖНИЙ машинный код полем-расширением (RFC 9457 §3.2): кто уже читает
 *    `error`, продолжает читать его без правок.
 *
 * Только публичные машинные адреса. Внутренние ручки интерфейса — не трогаем: их читает
 * наш же код, и у них свой контракт.
 */
export const PROBLEM_JSON = 'application/problem+json'

export interface ProblemOptions {
  /** Объяснение для человека — конкретно этот случай, а не статус словами. */
  detail?: string
  headers?: Record<string, string>
  /** Поля-расширения сверх `error` (например, `retryAfter`). */
  extra?: Record<string, unknown>
}

export function problem(status: number, error: string, opts: ProblemOptions = {}): Response {
  // Поля стандарта и `error` — ПОСЛЕ расширений: расширение не может подменить тип,
  // статус или машинный код.
  const body = {
    ...opts.extra,
    type: 'about:blank',
    title: STATUS_CODES[status] ?? 'Error',
    status,
    ...(opts.detail ? { detail: opts.detail } : {}),
    error,
  }
  // Отказ не кешируется: созданный позже список иначе какое-то время отвечал бы
  // «не найдено» из чужого прокси. `no-store` — последним: чужой заголовок его не снимет.
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...opts.headers, 'Content-Type': `${PROBLEM_JSON}; charset=utf-8`, ...noStoreHeaders() },
  })
}

/** Частотный лимит — Problem Details с `Retry-After` и прежним полем `retryAfter`. */
export const problemTooMany = (r: RateResult) =>
  problem(429, 'rate_limited', { headers: { 'Retry-After': String(r.retryAfter) }, extra: { retryAfter: r.retryAfter } })

/** Просит ли клиент ошибку в формате Problem Details (нужно там, где тело по умолчанию — другое). */
export const wantsProblem = (req: Request) => (req.headers.get('accept') ?? '').toLowerCase().includes(PROBLEM_JSON)

/**
 * «Списка нет» — одной фразой на все адреса списка. Приватный без прав неотличим от
 * несуществующего: 403 подтверждал бы, что такой список есть.
 */
export const problemListNotFound = () => problem(404, 'not_found', { detail: 'No such list, or it is not visible to you.' })
