import { describe, expect, it } from 'vitest'
import { movedPath } from '@/shared/db/moved-list'

// Правило переезда адреса: меняется ТОЛЬКО сегмент owner/slug, остальное едет как есть.
// Так же устроено перенаправление в Gitea — там заменяют ровно `owner/name` в пути и
// сохраняют весь хвост с query, поэтому доезжают и вкладки, и git-эндпоинты.
describe('movedPath', () => {
  const from = '/miki/api-old'
  const to = '/miki/api-new'

  it('корень списка', () => {
    expect(movedPath(from, from, to)).toBe(to)
  })

  it('вкладка сохраняется', () => {
    expect(movedPath(`${from}/issues`, from, to)).toBe(`${to}/issues`)
  })

  it('query сохраняется', () => {
    expect(movedPath(`${from}/issues?state=open`, from, to)).toBe(`${to}/issues?state=open`)
  })

  it('git-эндпоинт с точкой и query', () => {
    expect(movedPath(`${from}.git/info/refs?service=git-upload-pack`, from, to)).toBe(
      `${to}.git/info/refs?service=git-upload-pack`,
    )
  })

  it('без пути в заголовке — корень нового адреса', () => {
    expect(movedPath(null, from, to)).toBe(to)
  })

  // `/miki/api-old-2` начинается с `/miki/api-old`, но это ДРУГОЙ список. Такой путь
  // сюда не попадает (сегмент slug разбирает роутер), а если попадёт — хвост чужого
  // адреса не должен приклеиться к новому: обрезаем до корня, а не склеиваем
  // `/miki/api-new-2/issues`.
  it('хвост похожего, но чужого адреса не приклеивается', () => {
    expect(movedPath('/miki/api-old-2/issues', from, to)).toBe(to)
  })
})
