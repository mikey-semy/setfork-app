import { describe, expect, it } from 'vitest'
import { matchBlockTypes, slashQuery } from '@/features/library/list-editor/block-meta'
import { BLOCK_TYPES } from '@/features/library/blocks'

/**
 * СЛЭШ-МЕНЮ ОТКРЫВАЕТСЯ ТАМ, ГДЕ ЕГО ЖДУТ, И МОЛЧИТ ТАМ, ГДЕ НЕТ.
 *
 * «/» — обычный знак: пути, дроби, «и/или». Если меню полезет на каждый слэш, писать
 * текст станет нельзя, поэтому условие открытия — отдельная функция с тестами, а не
 * условие внутри компонента.
 */
describe('запрос слэш-меню', () => {
  it('слэш в начале блока открывает меню', () => {
    expect(slashQuery('/')).toBe('')
    expect(slashQuery('/кар')).toBe('кар')
  })

  it('слэш внутри текста меню не открывает', () => {
    expect(slashQuery('см. /etc/hosts')).toBeNull()
    expect(slashQuery('и/или')).toBeNull()
    expect(slashQuery('')).toBeNull()
  })

  it('после переноса строки меню закрывается: человек уже пишет абзац', () => {
    expect(slashQuery('/кар\nдальше текст')).toBeNull()
  })
})

describe('подбор типа блока по запросу', () => {
  it('пустой запрос показывает все типы', () => {
    expect(matchBlockTypes('', 'ru')).toEqual([...BLOCK_TYPES])
  })

  it('находит по подписи на языке интерфейса', () => {
    expect(matchBlockTypes('кар', 'ru')).toEqual(['image'])
    expect(matchBlockTypes('vid', 'en')).toEqual(['video'])
  })

  it('находит по английскому коду типа при русском интерфейсе — раскладку переключают не все', () => {
    expect(matchBlockTypes('image', 'ru')).toEqual(['image'])
    expect(matchBlockTypes('quiz', 'ru')).toEqual(['quiz'])
  })

  it('регистр и пробелы не мешают', () => {
    expect(matchBlockTypes('  ОПР', 'ru')).toEqual(['poll'])
  })

  it('ничего не подошло — пустой список, меню такого не показывает', () => {
    expect(matchBlockTypes('щщщ', 'ru')).toEqual([])
  })
})
