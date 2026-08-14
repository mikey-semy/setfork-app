import { describe, expect, it } from 'vitest'
import { guessCatalog, type CatalogProfile } from '@/shared/lib/catalog-match'

// ПОДСКАЗКА ПОЛКИ. Мера у неё простая, а цена ошибки несимметрична: промолчать — значит
// оставить человеку тот же выбор, что и раньше; ошибиться — увести список на чужую полку,
// причём молча, потому что подсказка подставляется в поле сама. Поэтому тесты держат не
// столько «угадала», сколько «не выдумала».

const shelf = (name: string, tags: string[]): CatalogProfile => ({ name, title: name, tags })

const SKILLS = shelf('skills', ['skill', 'ai', 'prompt'])
const DEVOPS = shelf('devops', ['devops', 'docker', 'ci'])
const RECIPES = shelf('recipes', ['food', 'baking'])

describe('подсказка полки по тегам', () => {
  it('ведёт туда, где больше общих тегов', () => {
    expect(guessCatalog(['skill', 'ai'], [SKILLS, DEVOPS, RECIPES])).toMatchObject({ name: 'skills' })
  })

  it('одного общего тега достаточно, когда конкурентов нет', () => {
    // Больше данных нет — и это весь сигнал; человек видит причину и решает сам.
    expect(guessCatalog(['docker'], [SKILLS, DEVOPS, RECIPES])).toMatchObject({ name: 'devops', shared: ['docker'] })
  })

  it('при ничьей молчит: подбрасывание монеты — не совет', () => {
    expect(guessCatalog(['ai', 'docker'], [SKILLS, DEVOPS])).toBeNull()
  })

  it('без общих тегов молчит', () => {
    expect(guessCatalog(['travel'], [SKILLS, DEVOPS, RECIPES])).toBeNull()
  })

  it('молчит, когда тегов ещё не набрали или полок нет', () => {
    expect(guessCatalog([], [SKILLS])).toBeNull()
    expect(guessCatalog(['skill'], [])).toBeNull()
  })

  it('называет причину — по каким именно тегам совпало', () => {
    const guess = guessCatalog(['skill', 'prompt', 'docker'], [SKILLS, DEVOPS])

    expect(guess?.shared.sort()).toEqual(['prompt', 'skill'])
  })

  it('пустая полка никого к себе не зовёт', () => {
    // Свежая полка без списков не имеет тегов — значит и оснований подсказывать.
    expect(guessCatalog(['skill'], [shelf('empty', []), SKILLS])).toMatchObject({ name: 'skills' })
    expect(guessCatalog(['skill'], [shelf('empty', [])])).toBeNull()
  })
})
