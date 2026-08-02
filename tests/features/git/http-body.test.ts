import { describe, expect, it } from 'vitest'
import { gzipSync } from 'node:zlib'
import { GitBodyTooLarge, gitBodyMaxBytes, maybeGunzip, readGitBody } from '@/features/git/http-body'

const MB = 1024 * 1024

function req(body: Buffer | null, headers: Record<string, string> = {}): Request {
  return new Request('https://setfork.com/u/l.git/git-receive-pack', {
    method: 'POST',
    body: body as BodyInit | null,
    headers,
    // Node требует его для тела-стрима; на Buffer безвредно.
    duplex: 'half',
  } as RequestInit)
}

/**
 * Потолок тела — это не «аккуратность», а единственное, что стоит между чужим
 * `git push` и памятью процесса: до Ф0 тело читалось целиком, а сжатое ещё и
 * распаковывалось без ограничения.
 */
describe('тело git-запроса не может съесть память', () => {
  it('заведомо большое тело отвергается по заголовку, не читая его', async () => {
    // Заголовок врёт в бо́льшую сторону — тела тут почти нет. Именно так и должно
    // работать: отказ приходит ДО чтения, иначе потолок бесполезен.
    const r = req(Buffer.alloc(16), { 'content-length': String(64 * MB) })
    await expect(readGitBody(r, 1 * MB)).rejects.toBeInstanceOf(GitBodyTooLarge)
  })

  it('врущий В МЕНЬШУЮ сторону заголовок не помогает: считаем прочитанное', async () => {
    // Content-Length приходит от клиента, и доверять ему нельзя. Плюс git вправе
    // слать chunked, где заголовка нет вовсе.
    const r = req(Buffer.alloc(2 * MB), { 'content-length': '10' })
    await expect(readGitBody(r, 1 * MB)).rejects.toBeInstanceOf(GitBodyTooLarge)
  })

  it('тело в пределах потолка доезжает целиком и без искажений', async () => {
    const payload = Buffer.from('0032want d3adbeef\n0000')
    const out = await readGitBody(req(payload), 1 * MB)
    expect(out.equals(payload)).toBe(true)
  })

  it('пустое тело — не ошибка', async () => {
    expect((await readGitBody(req(null), 1 * MB)).length).toBe(0)
  })

  it('сжатие не обходит потолок: zip-бомба отвергается', async () => {
    // 5 МБ однородных данных сжимаются в единицы килобайт. Без maxOutputLength
    // такое тело проходило любой входной лимит и разворачивалось в памяти.
    const bomb = gzipSync(Buffer.alloc(5 * MB, 0x41))
    expect(bomb.length).toBeLessThan(64 * 1024)
    expect(() => maybeGunzip(bomb, 'gzip', 1 * MB)).toThrow(GitBodyTooLarge)
  })

  it('сжатое тело в пределах потолка распаковывается как раньше', () => {
    const payload = Buffer.from('0032want d3adbeef\n0000')
    expect(maybeGunzip(gzipSync(payload), 'gzip', 1 * MB).equals(payload)).toBe(true)
  })

  it('несжатое тело не трогаем', () => {
    const payload = Buffer.from('plain')
    expect(maybeGunzip(payload, null, 1 * MB)).toBe(payload)
  })

  it('ноль выключает потолок, а не запрещает всё', () => {
    // Соглашение проекта: 0 = без ограничения (так же у SETFORK_MAX_PACK_MB и
    // SETFORK_REPO_LIMIT_MB в ядре). Раньше ноль давал потолок 0 байт: несжатый
    // запрос получал 413 на пустом месте, а сжатый — 500 из недр zlib.
    process.env.SETFORK_GIT_MAX_BODY_MB = '0'
    try {
      expect(gitBodyMaxBytes()).toBe(Number.POSITIVE_INFINITY)
      const payload = Buffer.from('0032want d3adbeef\n0000')
      expect(maybeGunzip(gzipSync(payload), 'gzip').equals(payload)).toBe(true)
    } finally {
      delete process.env.SETFORK_GIT_MAX_BODY_MB
    }
  })

  it('значение меньше байта — опечатка, а не «выключено»', () => {
    process.env.SETFORK_GIT_MAX_BODY_MB = '0.0000001'
    try {
      expect(gitBodyMaxBytes()).toBe(1)
    } finally {
      delete process.env.SETFORK_GIT_MAX_BODY_MB
    }
  })

  it('дробная настройка в мегабайтах даёт целое число байт', () => {
    // Байты дробными не бывают, а это число уезжает в maxOutputLength zlib, чьи
    // требования к типу разнятся от версии к версии.
    process.env.SETFORK_GIT_MAX_BODY_MB = '1.1'
    try {
      expect(Number.isInteger(gitBodyMaxBytes())).toBe(true)
    } finally {
      delete process.env.SETFORK_GIT_MAX_BODY_MB
    }
  })
})
