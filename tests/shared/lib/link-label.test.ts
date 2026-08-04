import { describe, expect, it } from 'vitest'
import { displayUrl, linkHost, linkLabel } from '@/shared/lib/link-label'

describe('linkHost', () => {
  it('домен без www', () => {
    expect(linkHost('https://www.python.org/downloads/')).toBe('python.org')
    expect(linkHost('https://code.visualstudio.com/docs')).toBe('code.visualstudio.com')
  })

  it('адрес без схемы тоже разбирается', () => {
    expect(linkHost('docs.astral.sh/uv/')).toBe('docs.astral.sh')
  })

  it('мусор и пустота — пусто, а не исключение', () => {
    expect(linkHost('не ссылка')).toBe('')
    expect(linkHost(undefined)).toBe('')
    expect(linkHost('   ')).toBe('')
  })
})

describe('linkLabel', () => {
  it('подпись автора главнее', () => {
    expect(linkLabel('Документация uv', 'https://docs.astral.sh')).toBe('Документация uv')
  })

  it('без подписи показываем домен — ради этого пункт и делался', () => {
    expect(linkLabel(undefined, 'https://www.python.org/downloads/')).toBe('python.org')
    expect(linkLabel('   ', 'https://marketplace.visualstudio.com/items?itemName=ms-python.python')).toBe('marketplace.visualstudio.com')
  })

  it('не-URL остаётся текстом, ссылка не теряется', () => {
    expect(linkLabel(undefined, 'внутренний вики-раздел')).toBe('внутренний вики-раздел')
  })

  it('нет ни подписи, ни адреса — пусто', () => {
    expect(linkLabel(undefined, undefined)).toBe('')
  })
})

describe('displayUrl', () => {
  it('снимает протокол и хвостовой слэш', () => {
    expect(displayUrl('https://setfork.ru/')).toBe('setfork.ru')
    expect(displayUrl('http://example.com/path')).toBe('example.com/path')
  })
})
