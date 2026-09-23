import { describe, expect, it } from 'vitest'
import { formatHistory, HISTORY_TAIL, type HistoryMsg } from '@/features/dig/history'

/**
 * В ЛЕНТЕ ГОВОРЯТ РАЗНЫЕ МАСТЕРА — И В ПРОМПТЕ ТОЖЕ.
 *
 * Беседа уезжала мастеру безличным «GNOME:». Человек тем временем открывает другую
 * дверь (меняет собеседника) или мастер сам зовёт коллегу — и новый читает чужие
 * ответы как свои. Владелец увидел это в упор: выбрал Глоина, а тот ответил «я не
 * Глоин, а Броккр».
 */
const roster = [
  { id: 'tester', nameRu: 'Глоин', nameEn: 'Glóinn' },
  { id: 'devops', nameRu: 'Броккр', nameEn: 'Brokkr' },
]

describe('хвост беседы для промпта', () => {
  const talk: HistoryMsg[] = [
    { role: 'user', text: 'как проверить' },
    { role: 'gnome', who: 'devops', text: 'раскаткой' },
    { role: 'user', text: 'а тесты' },
    { role: 'gnome', who: 'tester', text: 'пирамидой' },
  ]

  it('каждая реплика подписана ИМЕНЕМ своего мастера', () => {
    const out = formatHistory(talk, roster, 'ru')
    expect(out, 'мастера говорят одним безличным голосом').toContain('Броккр: раскаткой')
    expect(out).toContain('Глоин: пирамидой')
  })

  it('двое в беседе остаются двумя, а не сливаются в одного', () => {
    const speakers = new Set(
      formatHistory(talk, roster, 'ru')
        .split('\n')
        .filter((l) => !l.startsWith('USER:'))
        .map((l) => l.split(':')[0]),
    )
    expect(speakers.size, 'сменившийся мастер примет чужие ответы за свои').toBe(2)
  })

  it('имя на языке ответа: по-русски Глоин, а не Glóinn', () => {
    expect(formatHistory(talk, roster, 'ru')).toContain('Глоин:')
    expect(formatHistory(talk, roster, 'en')).toContain('Glóinn:')
  })

  // ⚠️ Обратная сторона: подпись не имеет права заслонить, КТО спрашивал. Вопрос
  // человека — это вопрос человека, иначе мастер отвечает сам себе.
  it('реплики человека подписаны человеком', () => {
    expect(formatHistory([{ role: 'user', text: 'как' }], roster, 'ru')).toBe('USER: как')
  })

  it('мастера уже нет в ростере — реплика остаётся в беседе', () => {
    const out = formatHistory([{ role: 'gnome', who: 'ушёл-в-архив', text: 'слово' }], roster, 'ru')
    expect(out, 'звено беседы выпало — следующий ответ повиснет в воздухе').toContain('слово')
  })

  it('в промпт уходит ХВОСТ, а не вся беседа', () => {
    const long: HistoryMsg[] = Array.from({ length: HISTORY_TAIL + 5 }, (_, i) => ({ role: 'user' as const, text: `q${i}` }))
    const lines = formatHistory(long, roster, 'ru').split('\n')
    expect(lines.length, 'беседа растёт — промпт растёт вместе с ней').toBe(HISTORY_TAIL)
    expect(lines[lines.length - 1], 'в хвосте оказалось начало разговора, а не конец').toBe(`USER: q${HISTORY_TAIL + 4}`)
  })

  it('длинная реплика режется — одна простыня не съедает контекст', () => {
    const out = formatHistory([{ role: 'user', text: 'я'.repeat(900) }], roster, 'ru')
    expect(out.length, 'реплика уехала целиком').toBeLessThan(500)
  })
})
