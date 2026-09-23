import { describe, expect, it } from 'vitest'
import { fitsQuestion, guideAbout, guideQuestion, guideState } from '@/shared/ai/guide-question'

/**
 * ВОПРОС ПРОВОДНИКУ — один на прод и на замер: Jev выбрал верно 57 из 57 именно с этой
 * формулировкой, и слово, изменённое здесь, встраивает уже не то, что мерили.
 */
describe('вопрос «кто поведёт по пункту»', () => {
  it('«кто он» — первое предложение персоны без точки: иначе в критерии двойная', () => {
    expect(guideAbout('a pragmatic DevOps/SRE expert. Reliability is a number.')).toBe('a pragmatic DevOps/SRE expert')
    expect(guideAbout('a data analyst')).toBe('a data analyst')
  })

  it('разведчик — роль, а не ремесло: в вариантах его нет; универсал — только если никто не подходит', () => {
    const q = guideQuestion([
      { id: 'dba', about: 'a database engineer', domains: ['sql', 'postgresql'] },
      { id: 'hoarder', about: 'a scout', domains: ['*'] },
      { id: 'generalist', about: 'a well-rounded generalist', domains: ['*'] },
    ])
    expect(q.criteria).toEqual({
      dba: 'a database engineer. Craft: sql, postgresql.',
      generalist: "a well-rounded generalist. Pick ONLY when none of the other specialists' crafts fits the item.",
    })
  })

  it('состояние — список, теги, раздел и пункт; пустой раздел не пишется', () => {
    expect(guideState({ listTitle: 'L', tags: ['a', 'b'], item: 'X' })).toBe('Список: L\nТеги списка: a, b\nПункт: X')
    expect(guideState({ listTitle: 'L', tags: [], section: 'S', item: 'X' })).toContain('Раздел: S')
  })

  it('теневой вопрос спрашивает о ремесле ВЫБРАННОГО, а не «кто лучший»', () => {
    const q = fitsQuestion({ id: 'coder', about: 'a meticulous software engineer', domains: ['git'] })
    expect(q.type).toBe('noul')
    expect(q.instructions).toContain('a meticulous software engineer')
  })
})
