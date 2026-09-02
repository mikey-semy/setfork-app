import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * ⚠️ ПУТЬ ВХОДА ВОЗВРАЩАЕТ ТУДА, ОТКУДА ПРИШЛИ — НА ВСЕХ ВЕТКАХ.
 *
 * Веток четыре: пароль, регистрация, внешний провайдер и второй фактор. Достаточно
 * одной, забывшей про цель, чтобы подключение MCP молча не состоялось: человек попадёт
 * на главную и решит, что «не сработало». Владелец прошёл ровно это 02.09.2026.
 *
 * Проверка смотрит на КОД, а не на поведение: путь идёт через внешний домен, и целиком
 * его в тесте не проиграть — но видно, что ни одна ветка не заканчивается жёстким
 * возвратом на главную.
 */
const read = (p: string) =>
  readFileSync(new URL('../../' + p, import.meta.url).pathname, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/^\s*\/\/.*$/gm, (m) => m.replace(/[^\n]/g, ' '))

describe('возврат после входа', () => {
  it('вход паролем и регистрация уводят по цели, а не на главную', () => {
    const src = read('src/features/auth/actions.ts')
    expect(src, 'жёсткий возврат на главную теряет начатый поток').not.toMatch(/redirect\('\/'\)/)
    expect(src).toMatch(/safeNext\(/)
  })

  it('внешний провайдер забирает цель из куки', () => {
    const src = read('src/features/auth/oauth-finish.ts')
    expect(src).toMatch(/takeNext\(\)/)
    expect(src, 'возврат на appUrl без цели — это и есть высадка на главную').toMatch(/next \? /)
  })

  it('второй фактор — середина поездки, а не её конец', () => {
    const src = read('src/features/auth/twofa.ts')
    expect(src, 'у кого включён 2FA, терял поток именно здесь').toMatch(/takeNext\(\)/)
  })

  it('маршруты провайдеров запоминают цель перед уходом', () => {
    for (const p of ['github', 'yandex', 'vk']) {
      const src = read(`src/app/api/auth/${p}/route.ts`)
      expect(src, `${p}: цель не сохраняется — через провайдера параметры не проходят`).toMatch(/rememberNext\(/)
    }
  })
})
