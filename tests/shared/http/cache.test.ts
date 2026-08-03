import { describe, expect, it } from 'vitest'
import { cacheHeaders, noStoreHeaders, notModified } from '@/shared/http/cache'

// Кеш-политика машинных поверхностей — это часть контракта доступа, а не оптимизация:
// пока у публичного ответа есть окно свежести, закрытие списка не отзывает уже
// разданную копию. Здесь проверяется само правило, а по маршрутам — cache-policy.itest.

describe('политика общего кеша', () => {
  it('публичный ответ хранится, но перепроверяется каждый раз', () => {
    const h = cacheHeaders({ shared: true, etag: 'W/"v1"' })
    expect(h['Cache-Control']).toBe('public, no-cache')
    expect(h.ETag).toBe('W/"v1"')
  })

  it('у публичного ответа НЕТ окна свежести — ни max-age, ни stale-while-revalidate', () => {
    // Именно окно свежести переживало закрытие доступа: разослать отзыв внешнему
    // кешу некому, поэтому «отдай без вопроса N секунд» здесь недопустимо.
    const cc = cacheHeaders({ shared: true, etag: 'W/"v1"' })['Cache-Control']
    expect(cc).not.toMatch(/max-age=[1-9]/)
    expect(cc).not.toMatch(/stale-while-revalidate/)
    expect(cc).not.toMatch(/s-maxage/)
  })

  it('непубличный ответ не хранит никто', () => {
    const h = cacheHeaders({ shared: false, etag: 'W/"v1"' })
    expect(h['Cache-Control']).toBe('private, no-store')
  })

  it('договорный язык попадает в ключ кеша, заданный адресом — нет', () => {
    expect(cacheHeaders({ shared: true, negotiated: true }).Vary).toBe('Accept-Language, Cookie, Authorization')
    // Тело определяется адресом: лишний Vary: Cookie дробил бы общий кеш на
    // персональные копии и делал его бесполезным.
    expect(cacheHeaders({ shared: true }).Vary).toBe('Authorization')
  })

  it('приватный ответ всегда перечисляет все измерения представления', () => {
    expect(cacheHeaders({ shared: false }).Vary).toBe('Accept-Language, Cookie, Authorization')
  })

  it('отказ не хранит никто', () => {
    expect(noStoreHeaders()['Cache-Control']).toBe('private, no-store')
  })
})

describe('условный запрос', () => {
  const req = (etag?: string) => new Request('https://setfork.ru/a/b/raw', etag ? { headers: { 'If-None-Match': etag } } : undefined)

  it('совпавший ETag → 304 с теми же заголовками и без тела', async () => {
    const headers = { ETag: 'W/"v2"', 'Cache-Control': 'public, no-cache' }
    const res = notModified(req('W/"v2"'), 'W/"v2"', headers)
    expect(res?.status).toBe(304)
    expect(res?.headers.get('Cache-Control')).toBe('public, no-cache')
    expect(await res?.text()).toBe('')
  })

  it('другой или отсутствующий ETag → ответ отдаётся телом', () => {
    expect(notModified(req('W/"v1"'), 'W/"v2"', {})).toBeNull()
    expect(notModified(req(), 'W/"v2"', {})).toBeNull()
  })

  it('заголовок — СПИСОК валидаторов: совпадение любого даёт 304', () => {
    // Клиент вправе прислать несколько сохранённых представлений сразу.
    expect(notModified(req('W/"v1", W/"v2"'), 'W/"v2"', {})?.status).toBe(304)
    expect(notModified(req('W/"v1", W/"v3"'), 'W/"v2"', {})).toBeNull()
  })

  it('сравнение слабое: W/"x" и "x" — одно представление', () => {
    // RFC 9110 §8.8.3.2 — у условного GET сравнение валидаторов слабое.
    expect(notModified(req('"v2"'), 'W/"v2"', {})?.status).toBe(304)
    expect(notModified(req('W/"v2"'), '"v2"', {})?.status).toBe(304)
  })

  it('звёздочка совпадает с любым представлением', () => {
    expect(notModified(req('*'), 'W/"v2"', {})?.status).toBe(304)
  })

  it('запятая внутри ETag не рвёт разбор списка', () => {
    expect(notModified(req('W/"a,b"'), 'W/"a,b"', {})?.status).toBe(304)
    expect(notModified(req('W/"a,b"'), 'W/"b"', {})).toBeNull()
  })

  it('без ETag условный запрос не срабатывает', () => {
    expect(notModified(req('W/"v2"'), undefined, {})).toBeNull()
  })
})
