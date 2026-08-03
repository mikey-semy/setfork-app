import { describe, expect, it } from 'vitest'
import { blockChatTitle } from '@/features/library/blocks'

// Подпись блока в шапке чата раскопки. Содержимое блока НЕ разбираем: первой
// строкой markdown может быть картинка, таблица или код — подпись берётся из
// структуры (заголовок шага → секция урока → тип блока).
describe('blockChatTitle', () => {
  it('у шага — его заголовок', () => {
    expect(blockChatTitle('step', 'Установить VS Code', 'Редактор', 'ru')).toBe('Установить VS Code')
  })
  it('у блока без заголовка — секция урока', () => {
    expect(blockChatTitle('text', '', 'Редактор', 'ru')).toBe('Редактор')
  })
  it('без заголовка и секции — имя типа на языке зрителя', () => {
    expect(blockChatTitle('text', '', '', 'ru')).toBe('Текст')
    expect(blockChatTitle('text', '', '', 'en')).toBe('Text')
  })
  it('пробельные значения не считаются подписью', () => {
    expect(blockChatTitle('text', '   ', '  ', 'en')).toBe('Text')
  })
})
