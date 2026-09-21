import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { relSrc, walkSrc } from '../helpers/walk-src'

/**
 * ЗАНЯТОСТЬ НИКА СПРАШИВАЮТ У КАНОНА — ВСЕ, КТО НИК ЗАВОДИТ.
 *
 * Канон — `handleBlock`/`handleTaken` в `shared/auth/handle.ts`. Он знает три вещи:
 * зарезервированные и админские ники, живого владельца БЕЗ учёта регистра и УДЕРЖАНИЕ
 * прежнего ника (180 дней, пока он ещё ведёт на своего человека из внешних ссылок и из
 * git remote в клонах его списков).
 *
 * ⚠️ Правило про СПОСОБ, а не про место. Корень «канон есть, зовут не все» повторился
 * здесь трижды:
 *   • #476 — регистрация не знала про админские ники: privesc самоназначением;
 *   • H1-001 — регистрация не знала про удержание: посторонний забирал чужие ссылки;
 *   • там же — аккаунт специалиста (`ai/gnome-account.ts`) искал свободное имя своим
 *     запросом и не знал ни про то, ни про другое.
 * Каждый раз чинили ОДНО место, а не способ. Отсюда узда: кто заводит ник — зовёт канон.
 *
 * Проверка намеренно НЕ трогает чтение `users.handle` (профиль, поиск, sitemap) — там
 * занятость ни при чём, и широкое правило дало бы десятки ложных срабатываний.
 */

/** Заводит ник: вставляет пользователя или переписывает колонку `handle`. */
const CREATES = /insert\(users\)|update\(users\)[\s\S]{0,80}?set\(\{[\s\S]{0,80}?handle/
/** Спрашивает канон — сам или через `uniqueHandle`, который зовёт его внутри. */
const ASKS_CANON = /\b(handleBlock|handleTaken|uniqueHandle)\b/

/**
 * Файлы, где ник — СИСТЕМНАЯ КОНСТАНТА, а не пользовательский ввод: спрашивать канон
 * не о чем, имя всегда одно и то же и уже лежит в `RESERVED_HANDLES`.
 * ⚠️ Список не «разрешение нарушать», а перечень мест, где нечего проверять. Добавлять
 * сюда можно только с таким же обоснованием — и с проверкой ниже, что ник и правда
 * зарезервирован.
 */
const SYSTEM_HANDLE_FILES: Record<string, string> = {
  'src/features/gardener/sweep/account.ts': 'gardener',
  'src/shared/auth/users.ts': 'demo',
  'src/features/settings/actions.ts': 'ghost',
}

describe('занятость ника спрашивают у канона', () => {
  const files = walkSrc(new URL('../../src', import.meta.url).pathname)

  it('каждый, кто заводит ник, зовёт handleBlock/handleTaken/uniqueHandle', () => {
    const offenders: string[] = []
    for (const file of files) {
      const src = readFileSync(file, 'utf8')
      if (!CREATES.test(src)) continue
      const rel = relSrc(file)
      if (ASKS_CANON.test(src)) continue
      if (rel in SYSTEM_HANDLE_FILES) continue
      offenders.push(rel)
    }
    expect(
      offenders,
      'ник заводится мимо канона: своя проверка занятости отстанет от него молча — ' +
        'так уже было с админскими никами (#476) и с удержанием прежнего (H1-001)',
    ).toEqual([])
  })

  it('исключения — действительно системные ники, а не забытые места', async () => {
    const { RESERVED_HANDLES } = await import('@/shared/auth/handle')
    for (const [file, handle] of Object.entries(SYSTEM_HANDLE_FILES)) {
      expect(RESERVED_HANDLES.has(handle), `${file}: «${handle}» не зарезервирован — значит его можно занять`).toBe(
        true,
      )
    }
  })

  it('проверке есть что проверять', () => {
    // Анти-вырождение: если `insert(users)` перепишут иначе, правило будет искать
    // пустоту и останется зелёным навсегда.
    const creators = files.filter((f) => CREATES.test(readFileSync(f, 'utf8')))
    expect(creators.length, 'мест, заводящих ник, не нашлось — правило потеряло предмет').toBeGreaterThan(3)
  })
})
