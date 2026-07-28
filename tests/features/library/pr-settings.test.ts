import { describe, expect, it } from 'vitest'
import { withPrDefaults } from '@/features/library/pr-settings'

describe('withPrDefaults', () => {
  it('способ слияния: squash только по точному значению, мусор → обычное', () => {
    expect(withPrDefaults({ mergeMethod: 'squash' }).mergeMethod).toBe('squash')
    expect(withPrDefaults({ mergeMethod: 'SQUASH' }).mergeMethod).toBe('merge')
    expect(withPrDefaults({ mergeMethod: 1 }).mergeMethod).toBe('merge')
  })

  it('пусто → дефолты (поведение до появления настроек)', () => {
    expect(withPrDefaults({})).toEqual({
      allowFrom: 'all',
      linearOnly: false,
      // Обычное слияние: squash теряет промежуточную историю — это выбор человека.
      mergeMethod: 'merge',
      blockOnUnresolved: true,
      requiredApprovals: 0,
      autoDeleteBranch: false,
      autoCloseIssues: true,
      // Правка чужого предложения мейнтейнером — только по явному согласию.
      allowMaintainerEdits: false,
    })
    expect(withPrDefaults(null)).toEqual(withPrDefaults({}))
    expect(withPrDefaults(undefined)).toEqual(withPrDefaults({}))
  })

  it('заданные значения побеждают дефолты', () => {
    const s = withPrDefaults({ blockOnUnresolved: false, autoDeleteBranch: true, requiredApprovals: 2, allowFrom: 'collaborators' })
    expect(s.blockOnUnresolved).toBe(false)
    expect(s.autoDeleteBranch).toBe(true)
    expect(s.requiredApprovals).toBe(2)
    expect(s.allowFrom).toBe('collaborators')
  })

  it('мусор в jsonb не превращается в дырку в гейте', () => {
    // Строка вместо boolean не должна читаться как «выключено».
    expect(withPrDefaults({ blockOnUnresolved: 'false' }).blockOnUnresolved).toBe(true)
    expect(withPrDefaults({ requiredApprovals: 'три' }).requiredApprovals).toBe(0)
    expect(withPrDefaults({ allowFrom: 'кто угодно' }).allowFrom).toBe('all')
  })

  it('число одобрений зажимается в разумные границы', () => {
    expect(withPrDefaults({ requiredApprovals: -5 }).requiredApprovals).toBe(0)
    expect(withPrDefaults({ requiredApprovals: 999 }).requiredApprovals).toBe(10)
    expect(withPrDefaults({ requiredApprovals: 2.7 }).requiredApprovals).toBe(2)
  })
})
