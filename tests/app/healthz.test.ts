import { describe, expect, it } from 'vitest'

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
    const src = await import('node:fs').then((fs) =>
      fs.readFileSync(new URL('../../src/app/api/health/route.ts', import.meta.url), 'utf8'),
    )
    expect(src).not.toMatch(/from '@\/shared\/db'/)
  })
})
