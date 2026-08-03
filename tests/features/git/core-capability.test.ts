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

const { coreEnforcesPushRoles } = await import('@/features/git/capabilities')

describe('возможности ядра', () => {
  beforeEach(() => {
    h.calls = 0
    h.answer = null
  })

  it('молчание ядра читается как «не умею»', async () => {
    expect(await coreEnforcesPushRoles()).toBe(false)
  })

  it('подтверждение принимается', async () => {
    h.answer = { enforcesPushRoles: true }
    expect(await coreEnforcesPushRoles()).toBe(true)
  })

  /**
   * Ключевое свойство: ответ НЕ запоминается. Кэш здесь однажды был и отменял
   * ровно тот сценарий, ради которого проверка заведена, — откат ядра назад
   * (авто-ревью fe#662). Право, запомненное про запас, действует дольше
   * основания.
   */
  it('откат ядра назад закрывает дверь СРАЗУ, без запомненного «умеет»', async () => {
    h.answer = { enforcesPushRoles: true }
    expect(await coreEnforcesPushRoles()).toBe(true)
    h.answer = { enforcesPushRoles: false } // ядро откатили
    expect(await coreEnforcesPushRoles()).toBe(false)
    expect(h.calls).toBe(2) // спросил оба раза
  })

  it('спрашивает ядро на каждом пуше', async () => {
    h.answer = { enforcesPushRoles: true }
    await coreEnforcesPushRoles()
    await coreEnforcesPushRoles()
    await coreEnforcesPushRoles()
    expect(h.calls).toBe(3)
  })
})
