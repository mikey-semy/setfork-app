import { describe, expect, it } from 'vitest'
import { errorForJob } from '@/shared/jobs/worker'
import { asDate } from '@/shared/db/raw'

// 13.08 петля самогенерации умерла с «i.getTime is not a function», и место
// падения восстановить не удалось: в задачу писали одно сообщение, а логи
// контейнера к тому времени прокрутились. Два теста держат оба урока.

describe('errorForJob', () => {
  it('сохраняет не только сообщение, но и адрес падения', () => {
    const boom = () => {
      throw new TypeError('i.getTime is not a function')
    }
    let saved = ''
    try {
      boom()
    } catch (e) {
      saved = errorForJob(e)
    }

    expect(saved).toContain('i.getTime is not a function')
    // Ради этого всё и затевалось: по записи должно быть видно, ГДЕ упало.
    expect(saved.split('\n').length).toBeGreaterThan(1)
    expect(saved).toMatch(/error-for-job\.test/)
  })

  it('переживает то, что бросили не Error', () => {
    expect(errorForJob('строка вместо ошибки')).toBe('строка вместо ошибки')
    expect(errorForJob({ code: 42 })).toContain('object')
  })

  it('влезает в отведённые под ошибку 1000 символов вместе со стеком', () => {
    const e = new Error('x'.repeat(200))
    expect(errorForJob(e).length).toBeLessThanOrEqual(1000)
  })
})

describe('asDate', () => {
  it('принимает и дату, и строку из сырого SQL', () => {
    const d = new Date('2026-08-13T02:21:20.678Z')
    expect(asDate(d)).toBe(d)
    // Ровно этот случай и ронял петлю: max(...) вернул строку, а на ней позвали .getTime().
    expect(asDate('2026-08-13 02:21:20.678+00')?.getTime()).toBe(d.getTime())
    expect(asDate(d.getTime())?.getTime()).toBe(d.getTime())
  })

  it('пустоту и мусор отдаёт как null, а не как Invalid Date', () => {
    expect(asDate(null)).toBeNull()
    expect(asDate(undefined)).toBeNull()
    expect(asDate('не дата')).toBeNull()
    expect(asDate(new Date('не дата'))).toBeNull()
    expect(asDate({})).toBeNull()
  })
})
