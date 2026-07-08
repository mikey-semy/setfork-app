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

  it('ignores too-short handles', () => {
    expect(extractHandles('@ab is too short but @abc is fine')).toEqual(['abc'])
  })
})
