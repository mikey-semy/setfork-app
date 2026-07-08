import { describe, expect, it } from 'vitest'
import { splitRefs } from '@/shared/ui/remark-issue-refs'

const B = '/demo/redis/issues'
const links = (nodes: ReturnType<typeof splitRefs>) => nodes.filter((n) => n.type === 'link').map((n) => n.url)

describe('splitRefs — #N issue references', () => {
  it('links a bare #N', () => {
    const n = splitRefs('see #12 for details', B)
    expect(links(n)).toEqual(['/demo/redis/issues/12'])
    expect(n.map((x) => x.value ?? x.children?.[0].value).join('')).toBe('see #12 for details')
  })

  it('links multiple refs', () => {
    expect(links(splitRefs('#1 and #2 and #345', B))).toEqual(['/demo/redis/issues/1', '/demo/redis/issues/2', '/demo/redis/issues/345'])
  })

  it('does NOT link ## or word#N or #Nletter', () => {
    expect(links(splitRefs('##5', B))).toEqual([])
    expect(links(splitRefs('color#5', B))).toEqual([])
    expect(links(splitRefs('#5abc', B))).toEqual([])
    expect(links(splitRefs('# heading', B))).toEqual([])
  })

  it('links at start of string and after punctuation', () => {
    expect(links(splitRefs('#7', B))).toEqual(['/demo/redis/issues/7'])
    expect(links(splitRefs('(#8)', B))).toEqual(['/demo/redis/issues/8'])
  })

  it('returns a single text node when no refs', () => {
    const n = splitRefs('nothing here', B)
    expect(n).toHaveLength(1)
    expect(n[0]).toMatchObject({ type: 'text', value: 'nothing here' })
  })
})
