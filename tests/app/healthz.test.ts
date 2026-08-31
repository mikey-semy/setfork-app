import { describe, expect, it, vi } from 'vitest'

/**
 * `/healthz` ОТВЕЧАЕТ, И ОТВЕЧАЕТ ТЕМ ЖЕ, ЧТО `/api/health`.
 *
 * Внешние наблюдатели по умолчанию спрашивают `/healthz` — это соглашение. У нас проба
 * живости лежала только на `/api/health`, и наблюдатель со стандартной настройкой
 * получал 404: проба показывала обратное тому, что есть (находка R4).
 *
 * Проверяется не «есть ли файл», а ДВА свойства: адрес отвечает успехом и отвечает тем
 * же, что оригинал. Второе важнее: две пробы живости разошлись бы молча — одна
 * научилась бы чему-то, вторая осталась бы прежней, и какая из них правда, выяснялось
 * бы в аварии.
 */
describe('/healthz', () => {
  it('отвечает 200 и тем же телом, что /api/health', async () => {
    const [healthz, health] = await Promise.all([import('@/app/healthz/route'), import('@/app/api/health/route')])

    const a = await healthz.GET()
    const b = await health.GET()

    expect(a.status).toBe(200)
    expect(await a.json()).toEqual(await b.json())
  })

  it('это ТОТ ЖЕ обработчик, а не его копия', async () => {
    // Копия — это второе место, где живёт правило «жив ли процесс». Ссылка на один
    // обработчик делает расхождение невозможным, и проверяется именно она.
    const healthz = await import('@/app/healthz/route')
    const health = await import('@/app/api/health/route')
    expect(healthz.GET).toBe(health.GET)
  })

  it('живость не ходит в базу: она про процесс, а не про зависимости', async () => {
    // При мёртвой базе живой процесс обязан отвечать 200 на liveness, иначе оркестратор
    // перезапустит его по кругу, не починив причину. «Готов ли обслуживать» — /api/ready.
    //
    // ⚠️ Проверка ИСХОДНИКА обработчика — заведомо слабая: она зелёная и при том, что
    // запрос доходит до базы ЧЕРЕЗ middleware, и обходится двойными кавычками, иным
    // путём импорта или транзитивной зависимостью. Оставлена как дешёвый первый рубеж,
    // но настоящую работу делает проверка ПУТИ ниже.
    const src = await import('node:fs').then((fs) =>
      fs.readFileSync(new URL('../../src/app/api/health/route.ts', import.meta.url), 'utf8'),
    )
    expect(src).not.toMatch(/from '@\/shared\/db'/)
  })
})

/**
 * ⚠️ ПРОБА ОБЯЗАНА ОТВЕЧАТЬ ДО ЛЮБОГО ОБРАЩЕНИЯ К БАЗЕ.
 *
 * `/healthz` не начинается с `/api/`, поэтому без явного обхода он в режиме ремонта
 * уходит в человеческую ветку и отвечает 503 с HTML-страницей — балансировщик выкидывает
 * ЖИВОЙ экземпляр из ротации (та самая цепочка unhealthy → Traefik → 404 на весь сайт).
 * А при зависшей базе `maintenanceEnabled()` не имеет своего предела ожидания, и здоровый
 * контейнер получает перезапуск по таймауту пробы.
 *
 * Прежний тест этого не ловил: он читал ИСХОДНИК обработчика и был зелёным, пока запрос
 * шёл в базу мимо него. Проверяем путь.
 */
describe('проба проходит middleware не глядя на базу', () => {
  it('в режиме ремонта /healthz отвечает не заглушкой', async () => {
    vi.doMock('@/shared/settings/maintenance', () => ({
      maintenanceEnabled: async () => {
        throw new Error('проба обязана ответить ДО обращения к базе')
      },
    }))
    vi.resetModules()
    const { middleware } = await import('@/middleware')
    const { NextRequest } = await import('next/server')

    const res = await middleware(new NextRequest(new Request('https://setfork.test/healthz')))
    expect(res.status, 'проба не должна получать 503 от ремонта').not.toBe(503)
    vi.doUnmock('@/shared/settings/maintenance')
  })
})
