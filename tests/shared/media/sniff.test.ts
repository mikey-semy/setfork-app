import { describe, expect, it } from 'vitest'
import { SNIFF_BYTES, sniffVideo } from '@/shared/media/sniff'

/** Тип клипа по содержимому: MP4 и QuickTime — один контейнер ISO-BMFF, различает major brand. */
const ftyp = (brand: string) => Buffer.concat([Buffer.from([0, 0, 0, 0x14]), Buffer.from('ftyp'), Buffer.from(brand), Buffer.alloc(8)])

describe('sniffVideo', () => {
  it("major brand 'qt  ' — QuickTime (.mov с iPhone)", () => {
    expect(sniffVideo(ftyp('qt  ').subarray(0, SNIFF_BYTES))).toBe('video/quicktime')
  })

  it.each(['isom', 'mp42', 'avc1', 'M4V '])("brand '%s' — MP4", (brand) => {
    expect(sniffVideo(ftyp(brand).subarray(0, SNIFF_BYTES))).toBe('video/mp4')
  })

  it('WebM и Ogg — по своим сигнатурам; не видео — null', () => {
    expect(sniffVideo(Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0, 0, 0, 0]))).toBe('video/webm')
    expect(sniffVideo(Buffer.from('OggS\0\0\0\0'))).toBe('video/ogg')
    expect(sniffVideo(Buffer.from('<html><body>'))).toBeNull()
  })
})
