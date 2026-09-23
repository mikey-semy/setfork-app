import { describe, expect, it } from 'vitest'
import { ATTACH_MAX_BYTES, uploadAccept, uploadContentType, uploadRejection, VIDEO_MAX_BYTES } from '@/shared/media/limits'
import { parseVideoEmbed } from '@/features/library/blocks'

/** Предпроверка тяжёлой загрузки — та же таблица, по которой отказывает сервер. */
describe('uploadRejection', () => {
  it('вложение из белого списка в пределе — пускаем', () => {
    expect(uploadRejection('file', { name: 'Отчёт.PDF', size: 10 })).toBeNull()
    expect(uploadRejection('file', { name: 'a.docx', size: ATTACH_MAX_BYTES })).toBeNull()
  })

  it('больше предела своего вида — too_big', () => {
    expect(uploadRejection('file', { name: 'a.pdf', size: ATTACH_MAX_BYTES + 1 })).toBe('too_big')
    expect(uploadRejection('video', { name: 'a.mp4', size: VIDEO_MAX_BYTES + 1 })).toBe('too_big')
    // У клипа предел свой, больше, чем у вложения.
    expect(uploadRejection('video', { name: 'a.mp4', size: ATTACH_MAX_BYTES + 1 })).toBeNull()
  })

  it('SVG, исполняемое и без расширения — bad_type', () => {
    for (const name of ['a.svg', 'a.exe', 'a.html', 'noext', 'a.pdf.sh']) {
      expect(uploadRejection('file', { name, size: 10 }), name).toBe('bad_type')
    }
    expect(uploadRejection('video', { name: 'a.pdf', size: 10 })).toBe('bad_type')
  })

  it('пустой файл — empty (политика хранилища требует от 1 байта)', () => {
    expect(uploadRejection('file', { name: 'a.pdf', size: 0 })).toBe('empty')
  })

  it('прототип объекта не расширение', () => {
    expect(uploadContentType('file', 'constructor')).toBeNull()
    expect(uploadContentType('file', 'tostring')).toBeNull()
  })

  it('клип хранится с настоящим видео-типом, вложение — только octet-stream', () => {
    expect(uploadContentType('video', 'webm')).toBe('video/webm')
    expect(uploadContentType('video', 'ogv')).toBe('video/ogg')
    expect(uploadContentType('file', 'pdf')).toBe('application/octet-stream')
  })

  it('accept для выбора файла — из той же таблицы', () => {
    expect(uploadAccept('video').split(',')).toEqual(['.mp4', '.webm', '.ogv', '.ogg'])
    expect(uploadAccept('file')).not.toContain('.svg')
  })
})

describe('parseVideoEmbed узнаёт свой клип', () => {
  it.each(['mp4', 'webm', 'ogv', 'ogg'])('/media/videos/…/uuid.%s → <video>', (ext) => {
    const url = `/media/videos/u1/0b1c2d3e-0000-4000-8000-000000000000.${ext}`
    expect(parseVideoEmbed(url)).toEqual({ kind: 'file', src: url })
  })

  it('вложение /media/files/… — не видео', () => {
    expect(parseVideoEmbed('/media/files/u1/x.pdf').kind).toBe('link')
  })
})
