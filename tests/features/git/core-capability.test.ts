import { beforeEach, describe, expect, it, vi } from 'vitest'

// Ф5: правило «посторонний пишет только в своё пространство» исполняет ЯДРО, а
// пускает постороннего фронт. Выкатываются они порознь, поэтому фронт спрашивает
// ядро, умеет ли оно это правило, — вместо того чтобы полагаться на порядок
// выкатки, который можно перепутать и который отменяется откатом ядра назад
// (авто-ревью core#80).

const h = vi.hoisted(() => ({ answer: null as null | { enforcesPushRoles: boolean }, calls: 0 }))

vi.mock('@/features/git/core', () => ({
  gitCore: {
    capabilities: async () => {
      h.calls++
      // Старое ядро не знает метода вовсе: Connect отдаёт UNIMPLEMENTED, а
      // реализация порта превращает любую неудачу в «не умеет».
      return h.answer ?? { enforcesPushRoles: false }
    },
  },
}))

const { coreEnforcesPushRoles, resetCoreCapabilityCache } = await import('@/features/git/capabilities')

describe('возможности ядра', () => {
  beforeEach(() => {
    h.calls = 0
    h.answer = null
    resetCoreCapabilityCache()
  })

  it('молчание ядра читается как «не умею»', async () => {
    expect(await coreEnforcesPushRoles()).toBe(false)
  })

  it('подтверждение помнит, лишний раз не спрашивает', async () => {
    h.answer = { enforcesPushRoles: true }
    expect(await coreEnforcesPushRoles()).toBe(true)
    expect(await coreEnforcesPushRoles()).toBe(true)
    expect(h.calls).toBe(1)
  })

  it('отказ помнит НЕДОЛГО — выкаченное ядро подхватывается само', async () => {
    const t0 = 1_000_000
    expect(await coreEnforcesPushRoles(t0)).toBe(false)
    // Ядро выкатили; фронт не перезапускали.
    h.answer = { enforcesPushRoles: true }
    expect(await coreEnforcesPushRoles(t0 + 29_000)).toBe(false) // ещё помнит отказ
    expect(await coreEnforcesPushRoles(t0 + 31_000)).toBe(true) // спросил заново
  })

  it('подтверждение помнит ДОЛЬШЕ, чем отказ', async () => {
    const t0 = 2_000_000
    h.answer = { enforcesPushRoles: true }
    expect(await coreEnforcesPushRoles(t0)).toBe(true)
    h.answer = { enforcesPushRoles: false }
    expect(await coreEnforcesPushRoles(t0 + 60_000)).toBe(true)
    expect(h.calls).toBe(1)
  })
})
