import { describe, expect, it } from 'vitest'
import { classifyProbe, looksSoft404, nextVerdict } from '@/features/linkcheck/classify'

describe('classifyProbe — таблица переходов', () => {
  it('2xx → ok; 2xx с другим finalUrl → redirected', () => {
    expect(classifyProbe({ status: 200 }, false)).toMatchObject({ verdict: 'ok', brokenCandidate: false })
    expect(classifyProbe({ status: 200 }, true)).toMatchObject({ verdict: 'redirected' })
  })
  it('404/410 и soft-404 → broken-кандидат', () => {
    expect(classifyProbe({ status: 404 }, false)).toMatchObject({ verdict: 'broken', brokenCandidate: true })
    expect(classifyProbe({ status: 410 }, false)).toMatchObject({ brokenCandidate: true })
    expect(classifyProbe({ status: 200, soft404: true }, false)).toMatchObject({ verdict: 'broken', reason: 'soft404', brokenCandidate: true })
  })
  it('бот-блок (401/403/429/999) → uncheckable, НЕ кандидат', () => {
    for (const s of [401, 403, 429, 999]) expect(classifyProbe({ status: s }, false)).toMatchObject({ verdict: 'uncheckable', brokenCandidate: false })
  })
  it('5xx → unreachable, не кандидат', () => {
    expect(classifyProbe({ status: 503 }, false)).toMatchObject({ verdict: 'unreachable', brokenCandidate: false })
  })
  it('RU-egress: сетевой отказ (timeout/reset/ТСПУ) НИКОГДА не кандидат в broken', () => {
    expect(classifyProbe({ status: null, netReason: 'net' }, false)).toMatchObject({ verdict: 'unreachable', brokenCandidate: false })
  })
  it('dns (NXDOMAIN) — кандидат, но только через эскалацию', () => {
    expect(classifyProbe({ status: null, netReason: 'dns' }, false)).toMatchObject({ verdict: 'unreachable', brokenCandidate: true })
  })
  it('приватный/мусорный URL → uncheckable', () => {
    expect(classifyProbe({ status: null, netReason: 'private' }, false)).toMatchObject({ verdict: 'uncheckable' })
    expect(classifyProbe({ status: null, netReason: 'bad_url' }, false)).toMatchObject({ verdict: 'uncheckable' })
  })
})

describe('nextVerdict — эскалация failCount', () => {
  const broken404 = classifyProbe({ status: 404 }, false)
  it('broken только после N подтверждений; до того публично unreachable', () => {
    expect(nextVerdict(broken404, 0, 3)).toEqual({ verdict: 'unreachable', failCount: 1 })
    expect(nextVerdict(broken404, 1, 3)).toEqual({ verdict: 'unreachable', failCount: 2 })
    expect(nextVerdict(broken404, 2, 3)).toEqual({ verdict: 'broken', failCount: 3 })
  })
  it('успех сбрасывает счётчик', () => {
    expect(nextVerdict(classifyProbe({ status: 200 }, false), 2, 3)).toEqual({ verdict: 'ok', failCount: 0 })
  })
  it('не-кандидат (сеть/бот-блок) счётчик не двигает', () => {
    expect(nextVerdict(classifyProbe({ status: null, netReason: 'net' }, false), 2, 3)).toEqual({ verdict: 'unreachable', failCount: 2 })
    expect(nextVerdict(classifyProbe({ status: 403 }, false), 2, 3)).toEqual({ verdict: 'uncheckable', failCount: 2 })
  })
})

describe('looksSoft404', () => {
  it('распознаёт title «не найдено» на обоих языках', () => {
    expect(looksSoft404('<html><title>404 — Page Not Found</title>')).toBe(true)
    expect(looksSoft404('<html><title>Страница не найдена</title>')).toBe(true)
    expect(looksSoft404('<html><title>Каталог товаров</title>')).toBe(false)
  })
})
