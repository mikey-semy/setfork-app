import { sql } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import { appSettings, db } from '@/shared/db'
import { getAiSettings } from '@/shared/settings/ai'
import { publishQuotaLeft } from '@/shared/agents/canary'

// ПРОБНИК линзы 03 (деньги), не для коммита: что делает мусор в ЧИСЛОВЫХ настройках БД.
//
// В env эту болезнь уже чинили (envNumber). Настройки из app_settings разбирает свой
// парсер: Number + Number.isFinite. Мусор он отбрасывает, но Number('') === 0 и
// Number('-5') === -5 — оба «конечные», то есть проходят как значение.
//
// Вопрос: что означает получившийся ноль для каждого потолка. Семантика у соседних
// настроек оказалась РАЗНОЙ, и это ловушка.
//
// Прогон: DATABASE_URL=... npx vitest run --config vitest.integration.config.ts tests/features/money/settings-junk-probe.itest.ts

const put = async (key: string, value: string) => {
  await db
    .insert(appSettings)
    .values({ key, value })
    .onConflictDoUpdate({ target: appSettings.key, set: { value } })
}

beforeEach(async () => {
  await db.execute(sql`delete from ${appSettings}`)
})

describe('мусор в числовых настройках расхода', () => {
  it('лимит советов: пустая строка и мусор → сколько получается', async () => {
    const итог: Record<string, number> = {}
    for (const junk of ['', 'abc', '-5', '0', '3']) {
      await put('ai.council_max_per_month', junk)
      const s = await getAiSettings()
      итог[JSON.stringify(junk)] = s.councilMaxPerMonth
    }
    console.log('councilMaxPerMonth ←', итог)

    // Как это читает продукт: features/generation/service.ts:121
    //   settings.councilMaxPerMonth > 0 && ... → 0 ОТКЛЮЧАЕТ лимит
    const лимитДействует = (v: number) => v > 0
    console.log(
      'ЛИМИТ ДЕЙСТВУЕТ?',
      Object.fromEntries(Object.entries(итог).map(([k, v]) => [k, лимитДействует(v)])),
    )

    expect(итог['""'], 'пустая строка должна давать дефолт, а не 0').toBeGreaterThan(0)
    expect(итог['"-5"'], 'отрицательное должно давать дефолт, а не отключать лимит').toBeGreaterThan(0)
  })

  it('суточная квота автопубликаций: ноль означает противоположное', async () => {
    await put('ai.readiness_per_day', '')
    const s = await getAiSettings()
    const left = await publishQuotaLeft('gardener', s.readinessPerDay)
    console.log('readinessPerDay ←', s.readinessPerDay, '| осталось публикаций:', left)
    // Здесь 0 = НОЛЬ публикаций (fail-closed) — противоположно смыслу нуля у советов.
    expect(left).toBe(0)
  })

  it('самогенерация: что даёт мусор в суточном капе', async () => {
    const итог: Record<string, number> = {}
    for (const junk of ['', 'abc', '-1']) {
      await put('ai.selfgen_per_day', junk)
      const s = await getAiSettings()
      итог[JSON.stringify(junk)] = s.selfGenPerDay
    }
    console.log('selfGenPerDay ←', итог)
    expect(итог['""'], 'пустая строка не должна молча обнулять кап').toBeGreaterThan(0)
  })
})
