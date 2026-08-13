import { describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { GET } from '@/app/api/ready/route'

/**
 * READINESS обязан краснеть при мёртвой базе — иначе он бесполезен.
 *
 * Линза 08, R10: `/api/health` при остановленном Postgres отвечал 200 за 45 мс,
 * контейнер оставался `healthy` и в ротации Traefik, а стриминговые страницы
 * отдавали 200 поверх сбоя (заголовок уходит раньше, чем падает запрос к БД) —
 * то есть http-мониторинг по коду ответа падения не видел вовсе.
 *
 * Проверка настоящая: гасим контейнер Postgres и смотрим ответ. Без имени
 * контейнера (ITEST_PG_CONTAINER) половина теста пропускается, а не притворяется
 * зелёной — проба, сделанная на моках, здесь ничего не доказывает.
 */
const PG = process.env.ITEST_PG_CONTAINER
const docker = (...args: string[]) => execFileSync('docker', args, { encoding: 'utf8' }).trim()

describe('readiness', () => {
  it('при живой базе — 200 и слово READY', async () => {
    const res = await GET()
    expect(res.status).toBe(200)
    await expect(res.text()).resolves.toMatch(/^READY db \d+ms/)
  })

  it.runIf(PG)('при мёртвой базе — 503 и причина в теле', async () => {
    docker('stop', PG!)
    try {
      const res = await GET()
      expect(res.status, 'мёртвая база обязана давать не-200').toBe(503)
      const body = await res.text()
      expect(body).toContain('NOT_READY')
      // Причина нужна прямо в теле: лезть в логи придётся ровно тогда, когда
      // логи и недоступны.
      expect(body.length, 'без причины тревога бесполезна').toBeGreaterThan('NOT_READY'.length + 5)
    } finally {
      docker('start', PG!)
      // Даём базе подняться, иначе следующий файл тестов упадёт на ровном месте.
      for (let i = 0; i < 30; i++) {
        try {
          docker('exec', PG!, 'pg_isready', '-U', 'ci')
          break
        } catch {
          await new Promise((r) => setTimeout(r, 1000))
        }
      }
    }
  })
})
