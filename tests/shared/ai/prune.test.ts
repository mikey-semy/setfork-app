import { describe, expect, it } from 'vitest'
import { pruneDrafts, trimToLines, DRAFT_CHAR_CAP } from '@/shared/ai/prune'

// Подрезка контекста на рёбрах совета. Главное свойство — она НЕ ДОЛЖНА оставлять след там,
// где её не было: типичный черновик обязан пройти нетронутым. Второе — резать только по
// границе строки: половина пункта хуже его отсутствия, модель достроит обрубок и будет
// спорить с тем, чего никто не писал.

const item = (n: number) => `${n}. Шаг номер ${n} с пояснением, зачем он нужен и как проверить результат`
const draft = (items: number) => Array.from({ length: items }, (_, i) => item(i + 1)).join('\n')

describe('подрезка по границе строки', () => {
  it('короткий текст возвращается КАК ЕСТЬ — без пометки и без изменений', () => {
    const t = draft(8)
    expect(t.length).toBeLessThan(DRAFT_CHAR_CAP)
    expect(trimToLines(t)).toBe(t)
  })

  it('длинный текст режется по строкам, не разрывая пункт', () => {
    const t = draft(60)
    const cut = trimToLines(t)
    expect(cut.length).toBeLessThanOrEqual(DRAFT_CHAR_CAP)
    expect(cut).toContain('…[обрезано]')
    // Последняя содержательная строка — целый пункт, а не его половина.
    const lines = cut.split('\n').filter((l) => l && !l.includes('обрезано'))
    expect(lines[lines.length - 1]).toBe(lines[lines.length - 1].trim())
    expect(t).toContain(lines[lines.length - 1])
  })

  it('одна гигантская строка всё же режется — иначе вернули бы пустоту', () => {
    const cut = trimToLines('я'.repeat(5000), 200)
    expect(cut.length).toBeLessThanOrEqual(200)
    expect(cut).toContain('…[обрезано]')
  })

  it('края обрезаются: лишние пробелы не считаются содержимым', () => {
    expect(trimToLines('  текст  ')).toBe('текст')
  })
})

describe('набор черновиков', () => {
  it('обычный виток не трогается вовсе, экономия ноль — и это честный ответ', () => {
    const { drafts, stat } = pruneDrafts([{ text: draft(7) }, { text: draft(9) }])
    expect(stat.trimmed).toBe(0)
    expect(stat.before).toBe(stat.after)
    expect(drafts[0].text).toBe(draft(7))
  })

  it('раздутый черновик подрезается, остальные — нет', () => {
    const { drafts, stat } = pruneDrafts([{ text: draft(7) }, { text: draft(80) }])
    expect(stat.trimmed).toBe(1)
    expect(stat.after).toBeLessThan(stat.before)
    expect(drafts[0].text).toBe(draft(7))
    expect(drafts[1].text).toContain('…[обрезано]')
  })

  it('прочие поля черновика сохраняются — подрезка не теряет авторство', () => {
    const { drafts } = pruneDrafts([{ text: draft(80), who: 'coder', letter: 'A' }])
    expect(drafts[0]).toMatchObject({ who: 'coder', letter: 'A' })
  })

  it('статистика считает символы до и после — экономия становится числом', () => {
    const { stat } = pruneDrafts([{ text: draft(80) }])
    expect(stat.before).toBeGreaterThan(stat.after)
    expect(stat.after).toBeLessThanOrEqual(DRAFT_CHAR_CAP)
  })
})
