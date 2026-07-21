import { describe, expect, it } from 'vitest'
import { resolveBuildId } from '@/shared/version'

describe('resolveBuildId', () => {
  it('env-переменная главнее файла', () => {
    expect(resolveBuildId('abc123', () => 'file-id')).toBe('abc123')
  })

  it('пустая/пробельная env игнорируется — берём файл', () => {
    expect(resolveBuildId('', () => 'file-id')).toBe('file-id')
    expect(resolveBuildId('   ', () => 'file-id\n')).toBe('file-id')
  })

  it('без env и файла (next dev) — dev', () => {
    expect(
      resolveBuildId(undefined, () => {
        throw new Error('ENOENT')
      }),
    ).toBe('dev')
  })

  it('пустой файл — тоже dev, а не пустой id', () => {
    expect(resolveBuildId(undefined, () => '  \n')).toBe('dev')
  })
})
