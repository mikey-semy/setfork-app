import { describe, expect, it } from 'vitest'
import { domainAffinity, matchScore, pickPrecedents } from '@/shared/ai/precedent-filter'

const P = (title: string, tags: string[]) => ({ title, tags })

const ALL = [
  P('Борщ классический', ['кулинария', 'cooking', 'суп']),
  P('Деплой на VPS', ['deploy', 'devops']),
  P('Сборы в поход', ['travel', 'снаряжение']),
  P('Маршмеллоу дома', ['recipe', 'десерты']),
]

describe('pickPrecedents', () => {
  it("домен '*' (универсал/барахольщик) → топ по близости как есть", () => {
    expect(pickPrecedents(ALL, ['*'], 3)).toEqual(ALL.slice(0, 3))
  })

  it('повар видит кулинарное: равенство и вхождение в обе стороны', () => {
    const out = pickPrecedents(ALL, ['cooking', 'food', 'recipe', 'kitchen', 'baking'])
    expect(out.map((p) => p.title)).toEqual(['Борщ классический', 'Маршмеллоу дома'])
  })

  it('регистронезависимо', () => {
    const out = pickPrecedents([P('X', ['Deploy'])], ['deploy'])
    expect(out).toHaveLength(1)
  })

  it('ни один тег не совпал → фолбэк на топ (пустой контекст хуже общего)', () => {
    const out = pickPrecedents(ALL, ['fitness', 'health'], 2)
    expect(out).toEqual(ALL.slice(0, 2))
  })

  it('limit режет и матчи, и фолбэк', () => {
    expect(pickPrecedents(ALL, ['*'], 1)).toHaveLength(1)
    expect(pickPrecedents(ALL, ['cooking', 'recipe'], 1)).toHaveLength(1)
  })
})

describe('matchScore — границы слова вместо подстроки', () => {
  // Регрессия, найденная прогоном раздачи ухода на реальных данных: кулинарный список
  // с тегом 'not-programming' уходил Кодеру, потому что подстрока совпадала.
  it('тег-отрицание НЕ считается темой', () => {
    expect(matchScore('not-programming', 'programming')).toBe(0)
    expect(matchScore('non-cooking', 'cooking')).toBe(0)
    expect(matchScore('не-программирование', 'программирование')).toBe(0)
  })

  it('точное совпадение — и тега, и слова внутри тега', () => {
    expect(matchScore('cooking', 'cooking')).toBe(2)
    expect(matchScore('home-cooking', 'cooking')).toBe(2)
  })

  it('производные формы — от 3 символов', () => {
    expect(matchScore('deployments', 'deploy')).toBe(1)
    expect(matchScore('dev', 'devops')).toBe(1)
  })

  it('двухбуквенные не ловят чужие слова (исходный фикс ревью)', () => {
    expect(matchScore('go', 'golang')).toBe(0)
    expect(matchScore('lego', 'go')).toBe(0)
  })

  it('domainAffinity: точное весит больше производного, «*» не выигрывает', () => {
    expect(domainAffinity(['cooking'], ['cooking'])).toBe(2)
    expect(domainAffinity(['dev'], ['devops'])).toBe(1)
    expect(domainAffinity(['cooking', 'dessert'], ['*'])).toBe(0)
    // Отрицание не добавляет веса профильному специалисту.
    expect(domainAffinity(['cooking', 'not-programming'], ['programming'])).toBe(0)
  })
})
