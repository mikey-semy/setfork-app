import { describe, expect, it } from 'vitest'
import { contributorsEnabled, openForContributions } from '@/features/library/push-role'

/**
 * Ф5: кто получает роль `contributor`.
 *
 * Роль — ответ на вопрос «в каком качестве человек пушит», и по ней ЯДРО
 * механически ограничивает пространство имён. Цена ошибки несимметрична: лишний
 * `owner` отдаёт постороннему main, лишний отказ всего лишь закрывает дверь,
 * которая до Ф5 и так была закрыта.
 *
 * Проверяется НАСТОЯЩАЯ функция роута, а не её копия: правило, повторённое в
 * тесте, проверяет само себя.
 */

const open = {
  visibility: 'public',
  status: 'published',
  moderation: 'active',
  prSettings: { allowFrom: 'all' },
}

describe('открытость списка для правок посторонних', () => {
  it('публичный опубликованный список с allowFrom=all открыт', () => {
    expect(openForContributions(open)).toBe(true)
  })

  it('приватный закрыт, даже если allowFrom=all', () => {
    // Иначе посторонний с write-токеном добрался бы до репозитория, который ему
    // не положено даже видеть.
    expect(openForContributions({ ...open, visibility: 'private' })).toBe(false)
  })

  it('черновик закрыт: он ещё не предъявлен миру', () => {
    expect(openForContributions({ ...open, status: 'draft' })).toBe(false)
  })

  it('скрытый модерацией закрыт', () => {
    // Список под takedown не может принимать вклад — иначе модерация обходится
    // через git.
    expect(openForContributions({ ...open, moderation: 'hidden' })).toBe(false)
  })

  it('allowFrom=collaborators закрывает git так же, как веб-форму', () => {
    // Ровно то расхождение, ради которого фаза делалась, только в обратную
    // сторону: настройка обязана действовать на ОБА пути одинаково.
    expect(openForContributions({ ...open, prSettings: { allowFrom: 'collaborators' } })).toBe(false)
  })

  it('рубильник по умолчанию ВЫКЛЮЧЕН', () => {
    // Иначе в окно выкатки (фронт раньше ядра) посторонний пушил бы прямо в
    // main: старое ядро молча игнорирует незнакомое поле роли, и правила
    // пространства имён там ещё нет.
    const prev = process.env.SETFORK_GIT_CONTRIBUTORS
    try {
      delete process.env.SETFORK_GIT_CONTRIBUTORS
      expect(contributorsEnabled()).toBe(false)
      process.env.SETFORK_GIT_CONTRIBUTORS = '0'
      expect(contributorsEnabled()).toBe(false)
      process.env.SETFORK_GIT_CONTRIBUTORS = 'true' // включает ровно '1', не «что-то похожее»
      expect(contributorsEnabled()).toBe(false)
      process.env.SETFORK_GIT_CONTRIBUTORS = '1'
      expect(contributorsEnabled()).toBe(true)
    } finally {
      if (prev === undefined) delete process.env.SETFORK_GIT_CONTRIBUTORS
      else process.env.SETFORK_GIT_CONTRIBUTORS = prev
    }
  })

  it('мусор в настройках читается как «по умолчанию», а не как «открыто всем»', () => {
    // prSettings приходит из jsonb и может быть чем угодно. Дефолт здесь как раз
    // 'all', и это осознанно — но проверить стоит, что путь через withPrDefaults
    // не падает и не выдаёт undefined.
    expect(openForContributions({ ...open, prSettings: 'сломанное' })).toBe(true)
    expect(openForContributions({ ...open, prSettings: null })).toBe(true)
  })
})
