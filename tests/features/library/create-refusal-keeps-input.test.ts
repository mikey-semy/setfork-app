import { describe, expect, it, vi } from 'vitest'

/**
 * ОТКАЗ РОЖДЕНИЯ СПИСКА — ЗНАЧЕНИЕ, А НЕ ПЕРЕХОД.
 *
 * Форма `/new` — редактор блоков: название, описание, теги и все пункты. Отказ уносил
 * переходом на `/new?e=…`, то есть новым GET, и человек терял ВСЁ набранное, а не только
 * повод для отказа: цена ошибки «адрес занят» была «набери список заново» (авто-ревью
 * #829). Значение отказа страницу не перерисовывает, и состояние редактора живёт дальше.
 *
 * Проверяется главное свойство: действие ВОЗВРАЩАЕТ отказ и НЕ зовёт `redirect`. Мок
 * перехода бросает — так видно попытку уйти, даже если возвращаемое значение совпадёт.
 */
const h = vi.hoisted(() => ({
  quotaOk: true,
  session: { userId: 'u1', handle: 'user' },
}))

vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw new Error(`переход вместо значения: ${to}`)
  },
}))
vi.mock('@/shared/auth/session', () => ({ requireSession: async () => h.session, getSession: async () => h.session }))
vi.mock('@/shared/i18n/server', () => ({ getLang: async () => 'ru' }))
vi.mock('@/shared/quota', () => ({
  listQuota: async () => ({ used: h.quotaOk ? 0 : 7, limit: 7, ok: h.quotaOk, unlimited: false }),
}))

const { createTemplate } = await import('@/features/library/actions/versions')

const form = (fields: Record<string, string>) => {
  const fd = new FormData()
  for (const [k, v] of Object.entries(fields)) fd.set(k, v)
  return fd
}

describe('отказ на создании списка', () => {
  it('пустое название — отказ значением, а не тишина', async () => {
    // Раньше действие просто возвращалось: человек жал «Создать» и не получал ничего.
    expect(await createTemplate(null, form({ title: '   ' }))).toEqual({ kind: 'no_title' })
  })

  it('предел числа списков — отказ значением, ввод остаётся у человека', async () => {
    h.quotaOk = false
    try {
      expect(await createTemplate(null, form({ title: 'Список' }))).toEqual({ kind: 'list_quota', limit: 7 })
    } finally {
      h.quotaOk = true
    }
  })
})
