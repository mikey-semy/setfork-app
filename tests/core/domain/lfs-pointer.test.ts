import { describe, expect, it } from 'vitest'
import { authoredFileInfo, binaryAllowedAt, lfsPointerOf, lfsPointerText, nativeExecutable, parseLfsPointer } from '@/core/domain/lfs-pointer'

// Указатель Git LFS — байт в байт по спецификации: его читают git-lfs и форджи.
const OID = 'a'.repeat(64)
describe('указатель Git LFS', () => {
  it('форма спецификации: version первой, LF, перевод строки в конце', () => {
    expect(lfsPointerText({ oid: OID, size: 12 })).toBe(`version https://git-lfs.github.com/spec/v1\noid sha256:${OID}\nsize 12\n`)
  })
  it('разбор — обратный записи', () => {
    expect(parseLfsPointer(lfsPointerText({ oid: OID, size: 7 }))).toEqual({ oid: OID, size: 7 })
  })
  it.each([
    ['CRLF', `version https://git-lfs.github.com/spec/v1\r\noid sha256:${OID}\r\nsize 7\r\n`],
    ['без перевода в конце', `version https://git-lfs.github.com/spec/v1\noid sha256:${OID}\nsize 7`],
    ['короткий хеш', 'version https://git-lfs.github.com/spec/v1\noid sha256:abc\nsize 7\n'],
    ['заглавные в хеше', `version https://git-lfs.github.com/spec/v1\noid sha256:${'A'.repeat(64)}\nsize 7\n`],
    ['размер с нулём впереди', `version https://git-lfs.github.com/spec/v1\noid sha256:${OID}\nsize 07\n`],
    ['лишняя строка', `version https://git-lfs.github.com/spec/v1\noid sha256:${OID}\nsize 7\nx y\n`],
    ['обычный текст', '# Guide\n'],
  ])('не указатель: %s — значит обычный текстовый файл', (_n, text) => {
    expect(parseLfsPointer(text)).toBeNull()
  })
  it('длинный файл указателем быть не может', () => {
    expect(lfsPointerOf(new TextEncoder().encode(lfsPointerText({ oid: OID, size: 1 }) + ' '.repeat(300)))).toBeNull()
  })
})

describe('что показывать о файле', () => {
  const pointer = new TextEncoder().encode(lfsPointerText({ oid: OID, size: 5_000_000 }))
  it('указатель в assets/ — размер из указателя и признак двоичного', () => {
    expect(authoredFileInfo('assets/logo.png', pointer)).toEqual({ bytes: 5_000_000, binary: true })
  })
  it('тот же текст вне assets/ — обычный файл: двоичному там не место', () => {
    expect(binaryAllowedAt('references/p.md')).toBe(false)
    expect(authoredFileInfo('references/p.md', pointer)).toEqual({ bytes: pointer.length, binary: false })
  })
})

describe('программы платформ не раздаём', () => {
  it.each([
    ['pe', [0x4d, 0x5a, 0x90, 0]],
    ['elf', [0x7f, 0x45, 0x4c, 0x46]],
    ['mach-o', [0xcf, 0xfa, 0xed, 0xfe]],
    ['mach-o', [0xfe, 0xed, 0xfa, 0xcf]],
  ] as const)('%s', (kind, head) => {
    expect(nativeExecutable(new Uint8Array([...head, 0, 1, 2]))).toBe(kind)
  })
  it('PNG и PDF — не программы', () => {
    expect(nativeExecutable(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]))).toBeNull()
    expect(nativeExecutable(new TextEncoder().encode('%PDF-1.7'))).toBeNull()
  })
})
