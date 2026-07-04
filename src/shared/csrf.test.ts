import { describe, it, expect } from 'vitest'
import { sameOrigin } from './csrf'

describe('sameOrigin', () => {
  it('trusts Sec-Fetch-Site over everything', () => {
    expect(sameOrigin({ secFetchSite: 'same-origin' })).toBe(true)
    expect(sameOrigin({ secFetchSite: 'same-site' })).toBe(true)
    expect(sameOrigin({ secFetchSite: 'none' })).toBe(true) // user-initiated (bookmark/typed URL)
    expect(sameOrigin({ secFetchSite: 'cross-site' })).toBe(false)
  })

  it('cross-site wins even if Origin matches (header cannot be forged by JS)', () => {
    expect(sameOrigin({ secFetchSite: 'cross-site', origin: 'https://app.example', host: 'app.example' })).toBe(false)
  })

  it('falls back to Origin↔Host when Sec-Fetch-Site is absent', () => {
    expect(sameOrigin({ origin: 'https://app.example', host: 'app.example' })).toBe(true)
    expect(sameOrigin({ origin: 'https://evil.example', host: 'app.example' })).toBe(false)
  })

  it('allows requests with no Origin (curl / server-to-server)', () => {
    expect(sameOrigin({ host: 'app.example' })).toBe(true)
    expect(sameOrigin({})).toBe(true)
  })

  it('rejects a malformed Origin', () => {
    expect(sameOrigin({ origin: 'not a url', host: 'app.example' })).toBe(false)
  })
})
