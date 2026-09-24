import { afterEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { indexNowKey } from '@/shared/indexnow'

/**
 * ФАЙЛ КЛЮЧА INDEXNOW: `/<INDEXNOW_KEY>.txt` в корне отвечает ключом, остальное — как было.
 *
 * Корень занят профилями (`/[handle]`), поэтому ответ даёт middleware, и раньше ремонта:
 * поисковик проверяет ключ в любой момент, а отказ стоил бы отказа всей пачки (403).
 */
let maintenance = false
vi.mock('@/shared/settings/maintenance', () => ({ maintenanceEnabled: async () => maintenance }))

const { middleware } = await import('@/middleware')

const KEY = 'not-a-real-key'
const call = (path: string) => middleware(new NextRequest(new Request(`https://setfork.test${path}`, { headers: { 'accept-language': 'en' } })))

afterEach(() => {
  vi.unstubAllEnvs()
  maintenance = false
})

describe('файл ключа IndexNow', () => {
  it('/<key>.txt — 200 и ровно ключ, text/plain', async () => {
    vi.stubEnv('INDEXNOW_KEY', KEY)
    const res = await call(`/${KEY}.txt`)
    expect(res.status).toBe(200)
    expect(await res.text()).toBe(KEY)
    expect(res.headers.get('content-type')).toBe('text/plain; charset=utf-8')
  })

  it('и в режиме ремонта: проверка ключа не должна срывать пачку', async () => {
    vi.stubEnv('INDEXNOW_KEY', KEY)
    maintenance = true
    const res = await call(`/${KEY}.txt`)
    expect(res.status).toBe(200)
    expect(await res.text()).toBe(KEY)
  })

  it('другой *.txt и ключ под языковым префиксом — ровно как без ключа', async () => {
    // Сравнение с ответом БЕЗ ключа, а не «не ключ»: правка, которая перехватила бы все
    // `*.txt` (robots.txt, llms.txt), отвечала бы 404 — и «не ключ» осталось бы зелёным.
    const shape = async (path: string) => {
      const res = await call(path)
      return { status: res.status, rewrite: res.headers.get('x-middleware-rewrite'), next: res.headers.get('x-middleware-next') }
    }
    for (const path of ['/robots.txt', '/llms.txt', '/other-key-123.txt', `/ru/${KEY}.txt`, `/${KEY}.txt.bak`]) {
      const without = await shape(path)
      vi.stubEnv('INDEXNOW_KEY', KEY)
      expect(await shape(path), path).toEqual(without)
      vi.unstubAllEnvs()
    }
  })

  it('без INDEXNOW_KEY — функции нет: /<key>.txt идёт дальше, как любой адрес', async () => {
    const res = await call(`/${KEY}.txt`)
    expect(await res.text()).not.toBe(KEY)
  })

  it('ключ не по правилам протокола — выключено', () => {
    for (const bad of ['short', 'has space inside', 'под_чёрточкой', 'x'.repeat(129)]) {
      expect(indexNowKey({ INDEXNOW_KEY: bad }), bad).toBeNull()
    }
    expect(indexNowKey({ INDEXNOW_KEY: ` ${KEY} ` })).toBe(KEY)
    expect(indexNowKey({})).toBeNull()
  })
})
