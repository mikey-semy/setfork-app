import { describe, expect, it } from 'vitest'
import { GNOME_CARDS, gnomeCard } from '@/shared/ai/gnome-character'

describe('gnome-character (одушевление)', () => {
  it('у каждого гнома карточка полна (трейт+тик+эмодзи)', () => {
    for (const [id, c] of Object.entries(GNOME_CARDS)) {
      expect(c.trait, id).toBeTruthy()
      expect(c.quirk, id).toBeTruthy()
      expect(c.emoji, id).toBeTruthy()
    }
  })
  it('ключевые роли и эксперты покрыты', () => {
    for (const id of ['planner', 'crier', 'critic', 'elder', 'chef', 'devops', 'coder', 'generalist']) {
      expect(GNOME_CARDS[id], id).toBeDefined()
    }
  })
  it('характеры РАЗНЫЕ — трейты не повторяются', () => {
    const traits = Object.values(GNOME_CARDS).map((c) => c.trait)
    expect(new Set(traits).size).toBe(traits.length)
  })
  it('неизвестный id → живой generic-фолбэк, не пустой', () => {
    const c = gnomeCard('who-is-this')
    expect(c.trait).toBeTruthy()
    expect(c.quirk).toBeTruthy()
    expect(c.emoji).toBeTruthy()
  })
})
