import { describe, expect, it } from 'vitest'
import { coauthorTrailers, withCoauthors } from '@/features/git/coauthors'

describe('трейлеры соавторов squash-коммита', () => {
  it('по одной строке на автора в порядке появления', () => {
    expect(
      coauthorTrailers([
        { name: 'Аня', email: 'a@x.ru' },
        { name: 'Boris', email: 'b@x.ru' },
      ]),
    ).toEqual(['Co-authored-by: Аня <a@x.ru>', 'Co-authored-by: Boris <b@x.ru>'])
  })

  it('повтор автора не даёт второй строки', () => {
    const out = coauthorTrailers([
      { name: 'Аня', email: 'a@x.ru' },
      { name: 'Аня', email: 'a@x.ru' },
    ])
    expect(out).toHaveLength(1)
  })

  it('подпись сервиса соавторством не считается', () => {
    // Иначе каждый squash приписывал бы соавтором сам сервис: коммиты слияния и
    // проекции сделаны им, а человеческого вклада в них нет.
    expect(coauthorTrailers([{ name: 'SetFork', email: 'git@setfork.com' }])).toEqual([])
  })

  it('пустое имя или почта пропускаются, а не дают ломаную строку', () => {
    expect(coauthorTrailers([{ name: '', email: 'a@x.ru' }, { name: 'Аня', email: '' }])).toEqual([])
  })

  it('без авторов сообщение остаётся заголовком без хвоста', () => {
    expect(withCoauthors('Правка (#7)', [])).toBe('Правка (#7)')
  })

  it('перед трейлерами пустая строка — иначе git их не видит', () => {
    const msg = withCoauthors('Правка (#7)', [{ name: 'Аня', email: 'a@x.ru' }])
    expect(msg).toBe('Правка (#7)\n\nCo-authored-by: Аня <a@x.ru>\n')
  })
})
