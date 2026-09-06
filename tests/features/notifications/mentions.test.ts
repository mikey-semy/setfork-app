import { describe, it, expect } from 'vitest'
import { extractHandles } from '@/features/notifications/mentions'

describe('extractHandles', () => {
  it('returns [] for empty / null', () => {
    expect(extractHandles('')).toEqual([])
    expect(extractHandles(null)).toEqual([])
    expect(extractHandles('no mentions here')).toEqual([])
  })

  it('extracts a single handle', () => {
    expect(extractHandles('hey @octocat look')).toEqual(['octocat'])
  })

  it('extracts multiple and dedupes, lowercased', () => {
    expect(extractHandles('@Alpha and @beta and @Alpha again')).toEqual(['alpha', 'beta'])
  })

  it('matches at start of string and after newline/punctuation', () => {
    expect(extractHandles('@lead\ncc @dev-two, thanks (@qa-bot)')).toEqual(['lead', 'dev-two', 'qa-bot'])
  })

  it('ignores e-mail addresses and paths', () => {
    expect(extractHandles('mail me at foo@bar-baz.com')).toEqual([])
    expect(extractHandles('see path a/@nested')).toEqual([])
    expect(extractHandles('double @@ghost')).toEqual([])
  })

  it('⚠️ не считает упоминанием «@» ВНУТРИ АДРЕСА', () => {
    // Запрет `/@` спасал только от пути. Адрес с параметром разбор проходил — перед «@»
    // стоит «=», — и уведомление уходило живому тёзке, хотя текст ссылки выбирал не тот,
    // от чьего имени оно приходило (садовник цитирует чужой список, человек — чужую
    // страницу). Правило теперь про МЕСТО: внутри адреса упоминаний не бывает.
    expect(extractHandles('битая ссылка: https://site.example/p?user=@alice')).toEqual([])
    expect(extractHandles('www.site.example/x?u=@bob&y=1')).toEqual([])
    expect(extractHandles('[архив](https://web.archive.org/web/*/https://x.io/@carol)')).toEqual([])
  })

  it('обращение РЯДОМ с адресом остаётся обращением', () => {
    // Вырезаем адрес, а не строку с адресом: иначе «почини это, @dev» под ссылкой
    // перестало бы кого-либо звать.
    expect(extractHandles('см. https://site.example/a — почини, @dev-two')).toEqual(['dev-two'])
  })

  it('ignores too-short handles', () => {
    expect(extractHandles('@ab is too short but @abc is fine')).toEqual(['abc'])
  })
})
