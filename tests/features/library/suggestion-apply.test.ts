import { describe, expect, it } from 'vitest'
import { applyFieldValue } from '@/features/library/suggestion-apply'
import type { ProposedItem } from '@/shared/db'

const item = {
  blockId: 'b1',
  title: { en: 'Install Docker', ru: 'Установить Docker' },
  desc: { en: 'old desc', ru: 'старое описание' },
  why: { en: 'why', ru: 'зачем' },
  section: { en: 'Setup', ru: 'Подготовка' },
  command: 'apt install docker',
} as unknown as ProposedItem

/**
 * Ошибка здесь не падает, а ТИХО ТЕРЯЕТ чужой текст: подставили не в то поле —
 * и правка «применилась», затерев соседнее. Поэтому примерами, а не на глаз.
 */
describe('applyFieldValue — подстановка предложенной правки', () => {
  it('заменяет названное поле', () => {
    const out = applyFieldValue(item, 'title', 'Установить Docker Engine 24', 'ru')
    expect((out.title as Record<string, string>).ru).toBe('Установить Docker Engine 24')
  })

  it('не трогает соседние поля', () => {
    const out = applyFieldValue(item, 'desc', 'новое описание', 'ru')
    expect(out.title).toEqual(item.title)
    expect(out.why).toEqual(item.why)
    expect(out.command).toBe(item.command)
  })

  it('перевод на другом языке остаётся — правка на русском не стирает английский', () => {
    const out = applyFieldValue(item, 'desc', 'новое описание', 'ru')
    expect((out.desc as Record<string, string>).en).toBe('old desc')
    expect((out.desc as Record<string, string>).ru).toBe('новое описание')
  })

  it('command — строка, а не LocaleText', () => {
    const out = applyFieldValue(item, 'command', 'docker compose up', 'ru')
    expect(out.command).toBe('docker compose up')
  })

  it('пустая строка — осмысленное предложение «здесь ничего не нужно»', () => {
    const out = applyFieldValue(item, 'why', '', 'ru')
    expect((out.why as Record<string, string>).ru).toBe('')
  })

  it('неизвестное поле не применяется наугад', () => {
    expect(applyFieldValue(item, 'subtasks', 'что-то', 'ru')).toEqual(item)
    expect(applyFieldValue(item, '', 'что-то', 'ru')).toEqual(item)
  })

  it('исходный пункт не мутируется', () => {
    const before = JSON.stringify(item)
    applyFieldValue(item, 'title', 'другое', 'ru')
    expect(JSON.stringify(item)).toBe(before)
  })
})
