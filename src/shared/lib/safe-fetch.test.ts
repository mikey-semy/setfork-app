import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchPublicUrl, isPrivateIp } from './safe-fetch'

// Хоп-логику тестируем герметично: stub'аем fetch, исходный хост — литеральный
// публичный IP (dns.lookup на IP-литерал не ходит в сеть). Так проверяем именно
// ре-валидацию каждого редиректа, без флейка от внешних сервисов.
const PUB = 'http://93.184.216.34' // литеральный публичный IP
function resp(status: number, headers: Record<string, string> = {}) {
  return new Response(status >= 300 && status < 400 ? null : 'ok', { status, headers })
}

describe('fetchPublicUrl (redirect-hop)', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('следует за публичной цепочкой редиректов до 200', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(resp(302, { location: '/b' })) // относительный → тот же публичный хост
      .mockResolvedValueOnce(resp(200))
    vi.stubGlobal('fetch', fetchMock)
    const res = await fetchPublicUrl(`${PUB}/a`)
    expect(res?.ok).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('блокирует редирект на приватный хост (не делает второй fetch)', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(resp(302, { location: 'http://169.254.169.254/latest/meta-data/' }))
    vi.stubGlobal('fetch', fetchMock)
    const res = await fetchPublicUrl(`${PUB}/a`)
    expect(res).toBeNull()
    expect(fetchMock).toHaveBeenCalledTimes(1) // до приватного хопа так и не дошёл
  })

  it('обрывает слишком длинную цепочку редиректов', async () => {
    const fetchMock = vi.fn().mockResolvedValue(resp(302, { location: `${PUB}/loop` }))
    vi.stubGlobal('fetch', fetchMock)
    expect(await fetchPublicUrl(`${PUB}/a`, {}, 2)).toBeNull()
    expect(fetchMock).toHaveBeenCalledTimes(3) // maxRedirects=2 → 3 попытки
  })

  it('отклоняет не-http и приватный прямой URL до сети', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    expect(await fetchPublicUrl('ftp://example.com/')).toBeNull()
    expect(await fetchPublicUrl('http://127.0.0.1:6379/')).toBeNull()
    expect(await fetchPublicUrl('http://10.0.0.1/')).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

// SSRF-гейт: приватные/служебные адреса не считаются публичными (fail closed).
describe('isPrivateIp', () => {
  it('блокирует loopback и unspecified', () => {
    for (const ip of ['127.0.0.1', '127.255.255.255', '0.0.0.0', '::1', '::']) {
      expect(isPrivateIp(ip), ip).toBe(true)
    }
  })

  it('блокирует приватные диапазоны v4', () => {
    for (const ip of ['10.0.0.1', '10.255.0.9', '192.168.1.1', '172.16.0.1', '172.31.255.254', '100.64.0.1', '100.127.9.9']) {
      expect(isPrivateIp(ip), ip).toBe(true)
    }
  })

  it('блокирует link-local (cloud metadata) и multicast/reserved', () => {
    for (const ip of ['169.254.169.254', '169.254.0.1', '224.0.0.1', '240.0.0.1', '255.255.255.255']) {
      expect(isPrivateIp(ip), ip).toBe(true)
    }
  })

  it('блокирует приватный IPv6: link-local, ULA, v4-mapped', () => {
    for (const ip of ['fe80::1', 'FE80::abcd', 'fc00::1', 'fd12:3456::1', '::ffff:127.0.0.1', '::ffff:10.0.0.5']) {
      expect(isPrivateIp(ip), ip).toBe(true)
    }
  })

  it('пропускает публичные адреса', () => {
    for (const ip of ['1.1.1.1', '8.8.8.8', '93.184.216.34', '172.15.0.1', '172.32.0.1', '100.128.0.1', '2606:4700::1111', '::ffff:8.8.8.8']) {
      expect(isPrivateIp(ip), ip).toBe(false)
    }
  })

  it('не-IP мусор — fail closed (true)', () => {
    for (const ip of ['', 'evil', '10.0.0', '1.2.3.4.5', '999.1.1.1']) {
      expect(isPrivateIp(ip), ip).toBe(true)
    }
  })
})
