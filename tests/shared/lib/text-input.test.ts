import { describe, expect, it } from 'vitest'
import { cleanText, normalizeText } from '@/shared/lib/text-input'
import { toProposed } from '@/shared/lib/step-input'

// Составная «ё» приезжает из редакторов, буфера macOS и от языковых моделей: выглядит как
// обычная буква, а строка другая. Владелец поймал это на списках, созданных через MCP, —
// пришлось править руками, не понимая, что именно чинишь.
const COMBINED_YO = 'ё' // «е» + комбинирующие точки
const SINGLE_YO = 'ё' // одна буква «ё»

describe('нормализация входящего текста', () => {
  it('составная «ё» становится одной буквой', () => {
    expect(normalizeText(`Расч${COMBINED_YO}т`)).toBe(`Расч${SINGLE_YO}т`)
    expect(normalizeText(`Расч${COMBINED_YO}т`).length).toBe(6)
  })

  it('одинаковые на вид строки после нормализации СОВПАДАЮТ', () => {
    // Ровно это ломало поиск и сравнение заголовков: глазами одно, для базы разное.
    expect(`Всё${COMBINED_YO}`).not.toBe(`Всё${SINGLE_YO}`)
    expect(normalizeText(`Всё${COMBINED_YO}`)).toBe(normalizeText(`Всё${SINGLE_YO}`))
  })

  it('невидимый мусор из документов убирается', () => {
    expect(normalizeText('шаг​первый')).toBe('шагпервый') // нулевая ширина
    expect(normalizeText('шаг первый')).toBe('шаг первый') // неразрывный пробел
  })

  it('обычный текст не портится', () => {
    expect(normalizeText('Deploy to VPS — шаг 1')).toBe('Deploy to VPS — шаг 1')
    expect(cleanText('  с краями  ')).toBe('с краями')
    expect(cleanText(undefined)).toBe('')
  })
})

describe('состав списка нормализуется на входе', () => {
  it('заголовок и подзадачи шага приходят в базу канонической формой', () => {
    const [item] = toProposed(
      [
        {
          title: `Расч${COMBINED_YO}т сметы`,
          desc: `Учт${COMBINED_YO}м налоги`,
          command: '',
          level: 'required',
          why: '',
          subtasks: [`Св${COMBINED_YO}л с бюджетом`],
          refs: [],
        },
      ],
      'ru',
    )

    expect(item.title.ru).toBe(`Расч${SINGLE_YO}т сметы`)
    expect(item.desc.ru).toBe(`Учт${SINGLE_YO}м налоги`)
    expect(item.subtasks[0].ru).toBe(`Св${SINGLE_YO}л с бюджетом`)
  })
})
