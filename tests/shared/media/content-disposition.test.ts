import { describe, expect, it } from 'vitest'
import { contentDisposition } from '@/shared/media/s3'

/** Имя вложения при скачивании: кириллица и кавычки не ломают заголовок. */
describe('contentDisposition', () => {
  it('ASCII-запасное + точное имя по RFC 5987', () => {
    expect(contentDisposition('attachment', 'отчёт (v2).pdf')).toBe(
      `attachment; filename="_____ (v2).pdf"; filename*=UTF-8''%D0%BE%D1%82%D1%87%D1%91%D1%82%20%28v2%29.pdf`,
    )
  })

  it('кавычка и обратный слеш в имени не закрывают filename=', () => {
    const h = contentDisposition('inline', 'a"b\\c.mp4')
    expect(h.startsWith('inline; filename="a_b_c.mp4";')).toBe(true)
  })
})
