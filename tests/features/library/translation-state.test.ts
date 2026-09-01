import { describe, expect, it } from 'vitest'
import { hasLang, type TranslatableRow } from '@/features/library/translation-state'

/**
 * Кнопка перевода нажимается повторно — и второй раз ответ обязан прийти из
 * данных, а не из модели. Здесь проверяется ровно то условие, по которому
 * translateList решает не ходить в ИИ.
 */

const row = (over: Partial<TranslatableRow> = {}): TranslatableRow => ({
  type: 'step',
  title: { en: 'Install', ru: 'Установить' },
  desc: {},
  why: {},
  subtasks: [],
  refs: [],
  content: null,
  ...over,
})

const tpl = { title: { en: 'Guide', ru: 'Руководство' }, desc: { en: 'About', ru: 'Про' } }

describe('hasLang', () => {
  it('видит готовый перевод — модель звать не нужно', () => {
    expect(hasLang(tpl, [row()], 'ru')).toBe(true)
  })

  it('не считает готовым язык, которого нет', () => {
    expect(hasLang(tpl, [row({ title: { en: 'Install' } })], 'ru')).toBe(false)
  })

  it('пустое поле переводить нечего', () => {
    expect(hasLang(tpl, [row({ desc: {}, why: null })], 'ru')).toBe(true)
  })

  /** Иначе один непереведённый шаг в конце списка остался бы таким навсегда. */
  it('одного недостающего поля хватает, чтобы позвать модель', () => {
    const rows = [row(), row({ why: { en: 'because' } })]
    expect(hasLang(tpl, rows, 'ru')).toBe(false)
  })

  it('проверяет подпункты и подписи ссылок', () => {
    expect(hasLang(tpl, [row({ subtasks: [{ en: 'one' }] })], 'ru')).toBe(false)
    expect(hasLang(tpl, [row({ refs: [{ label: { en: 'docs' } }] })], 'ru')).toBe(false)
    expect(hasLang(tpl, [row({ refs: [{ label: { en: 'docs', ru: 'док' } }] })], 'ru')).toBe(true)
  })

  /** Врезки хранились простой строкой: языкового измерения у неё нет, значит
   *  перевода нет — иначе текстовые блоки молча оставались бы одноязычными. */
  it('старая строковая врезка считается непереведённой', () => {
    const text = row({ type: 'text', content: { md: '# Заголовок' } })
    expect(hasLang(tpl, [text], 'en')).toBe(false)

    const both = row({ type: 'text', content: { md: { ru: '# Заголовок', en: '# Title' } } })
    expect(hasLang(tpl, [both], 'en')).toBe(true)
  })

  it('пустая врезка не держит список непереведённым', () => {
    expect(hasLang(tpl, [row({ type: 'text', content: { md: '' } })], 'en')).toBe(true)
  })

  /** Содержимое опроса перевод не трогает — требовать от него языка значило бы
   *  звать модель на каждое нажатие и каждый раз впустую. */
  it('не смотрит в контент не-текстовых блоков', () => {
    const poll = row({ type: 'poll', content: { question: 'Which one?' } })
    expect(hasLang(tpl, [poll], 'ru')).toBe(true)
  })

  it('заголовок самого списка тоже считается', () => {
    expect(hasLang({ title: { en: 'Guide' }, desc: {} }, [row()], 'ru')).toBe(false)
  })
})
