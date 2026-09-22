import { describe, expect, it } from 'vitest'
import { craftBasis } from '@/features/dig/basis'

/**
 * ОПОРА МАСТЕРА — СПИСКИ И ШАГИ ЕГО РЕМЕСЛА.
 *
 * Поиск возвращал и похожие списки, и отдельные шаги похожих списков, а до мастера
 * доезжали только списки: шаги выбрасывались, хотя за их поиск платил каждый ход. Для
 * списка с бедным описанием самое полезное — как раз шаги (авто-ревью #957).
 */
const cooking = ['готовка']
const list = (title: string, tags: string[]) => ({ title, desc: '', tags })
const step = (content: string, tags: string[]) => ({ content, tags })

describe('на что опирается мастер раскопки', () => {
  it('шаги-прецеденты доезжают до мастера', () => {
    const out = craftBasis({ lists: [], steps: [step('Бульон варить на слабом огне', ['готовка'])] }, cooking)
    expect(out.precedents, 'шаги найдены и выброшены').toContain('Бульон варить на слабом огне')
    expect(out.offCraft).toBe(false)
  })

  it('списки тоже на месте', () => {
    const out = craftBasis({ lists: [list('Суп', ['готовка'])], steps: [step('Бульон', ['готовка'])] }, cooking)
    expect(out.precedents).toEqual(['Суп', 'Бульон'])
  })

  it('шаги режутся той же линзой ремесла, что и списки', () => {
    const out = craftBasis(
      { lists: [], steps: [step('Раскатка через canary', ['deploy']), step('Соус томить', ['готовка'])] },
      cooking,
    )
    expect(out.precedents, 'повару подсунули деплой').toEqual(['Соус томить'])
  })

  // ⚠️ Пометка «не твоё ремесло» одна на всё. Если своё нашлось хоть где-то, общий фолбэк
  // другого вида подмешивать нельзя: он уйдёт мастеру без пометки, как опора по ремеслу.
  it('своё в шагах — чужие списки не подмешиваются', () => {
    const out = craftBasis({ lists: [list('Деплой в k8s', ['deploy'])], steps: [step('Соус томить', ['готовка'])] }, cooking)
    expect(out.precedents, 'чужой список выдан за опору ремесла').toEqual(['Соус томить'])
    expect(out.offCraft).toBe(false)
  })

  it('своё в списках — чужие шаги не подмешиваются', () => {
    const out = craftBasis({ lists: [list('Суп', ['готовка'])], steps: [step('canary', ['deploy'])] }, cooking)
    expect(out.precedents, 'чужой шаг выдан за опору ремесла').toEqual(['Суп'])
  })

  it('своего нет нигде — общее отдано и помечено честно', () => {
    const out = craftBasis({ lists: [list('Деплой', ['deploy'])], steps: [step('canary', ['deploy'])] }, cooking)
    expect(out.precedents).toEqual(['Деплой', 'canary'])
    expect(out.offCraft, 'чужая жила подана как своя').toBe(true)
  })

  it('ничего не нашлось — нечего и помечать', () => {
    expect(craftBasis({ lists: [], steps: [] }, cooking)).toEqual({ precedents: [], offCraft: false })
  })

  it('длинный шаг режется — одна простыня не съедает контекст', () => {
    const out = craftBasis({ lists: [], steps: [step('я'.repeat(900), ['готовка'])] }, cooking)
    expect(out.precedents[0].length, 'шаг уехал целиком').toBeLessThanOrEqual(240)
  })
})
