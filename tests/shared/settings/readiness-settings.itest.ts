import { sql } from 'drizzle-orm'
import { beforeAll, describe, expect, it } from 'vitest'
import { appSettings, db } from '@/shared/db'
import { getAiSettings } from '@/shared/settings/ai'
import { resetTables } from '../../helpers/reset-db'

// Круговой прогон настройки через БД. Именно этого не хватило в #488: ключи не были в
// массиве KEYS, настройка из админки НИКОГДА не читалась, а режим всегда оставался 'off'.
// Тест дешёвый и ловит ровно этот класс ошибки.

const set = async (key: string, value: string) => {
  await db.insert(appSettings).values({ key, value }).onConflictDoUpdate({ target: appSettings.key, set: { value } })
}

beforeAll(async () => {
  await resetTables([appSettings])
})

describe('планка готовности: настройка доезжает из БД', () => {
  it('дефолт без строк в БД — выключено и минимум 5 шагов', async () => {
    const s = await getAiSettings()
    expect({ mode: s.readinessMode, minSteps: s.readinessMinSteps }).toEqual({ mode: 'off', minSteps: 5 })
  })

  it("'shadow' и 'on' читаются, число тоже", async () => {
    await set('ai.readiness_mode', 'shadow')
    await set('ai.readiness_min_steps', '8')
    expect((await getAiSettings()).readinessMode).toBe('shadow')
    expect((await getAiSettings()).readinessMinSteps).toBe(8)
    await set('ai.readiness_mode', 'on')
    expect((await getAiSettings()).readinessMode).toBe('on')
  })

  it('класс полноты читается; мусор → solid, а не самая мягкая ступень', async () => {
    expect((await getAiSettings()).readinessMinGrade).toBe('solid') // дефолт
    await set('ai.readiness_min_grade', 'full')
    expect((await getAiSettings()).readinessMinGrade).toBe('full')
    await set('ai.readiness_min_grade', 'start')
    expect((await getAiSettings()).readinessMinGrade).toBe('start')
    await set('ai.readiness_min_grade', 'ЛЮБОЙ')
    expect((await getAiSettings()).readinessMinGrade).toBe('solid')
  })

  it('мусор в значении → off (опечатка не включает автопубликацию)', async () => {
    await set('ai.readiness_mode', 'ON!!')
    expect((await getAiSettings()).readinessMode).toBe('off')
  })
})
