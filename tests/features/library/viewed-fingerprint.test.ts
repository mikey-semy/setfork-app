import { describe, expect, it } from 'vitest'
import { blockFingerprint, isStaleMark } from '@/features/library/viewed-fingerprint'

const base = { title: 'Установить Docker', desc: 'Через apt', why: 'нужен рантайм', level: 'required' }

/**
 * По отпечатку решается, устарела ли отметка «просмотрено». Ошибка не падает, а
 * ВРЁТ ревьюеру: либо гасит отметки на нетронутых пунктах (и он проходит всё
 * заново), либо оставляет галочку на переписанном (и он пропускает изменение).
 */
describe('blockFingerprint', () => {
  it('одинаковое содержимое — одинаковый отпечаток', () => {
    expect(blockFingerprint(base)).toBe(blockFingerprint({ ...base }))
  })

  it('меняется от каждого показываемого поля', () => {
    const fp = blockFingerprint(base)
    expect(blockFingerprint({ ...base, title: 'Другое' })).not.toBe(fp)
    expect(blockFingerprint({ ...base, desc: 'Другое' })).not.toBe(fp)
    expect(blockFingerprint({ ...base, why: 'Другое' })).not.toBe(fp)
    expect(blockFingerprint({ ...base, level: 'optional' })).not.toBe(fp)
    expect(blockFingerprint({ ...base, command: 'apt install docker' })).not.toBe(fp)
  })

  it('подзадачи и ссылки входят в отпечаток', () => {
    const fp = blockFingerprint(base)
    expect(blockFingerprint({ ...base, subtasks: ['проверить версию'] })).not.toBe(fp)
    expect(blockFingerprint({ ...base, refs: [{ label: 'docs', url: 'https://docs.docker.com' }] })).not.toBe(fp)
  })

  it('статус в диффе различается: добавлен и удалён — не одно и то же', () => {
    expect(blockFingerprint({ ...base, status: 'added' })).not.toBe(blockFingerprint({ ...base, status: 'removed' }))
  })

  it('пустой content не сдвигает отпечаток у шага', () => {
    // Иначе у ВСЕХ старых шагов отметки разом стали бы «устаревшими».
    expect(blockFingerprint({ ...base, content: {} })).toBe(blockFingerprint(base))
  })

  it('содержимое не-step блока учитывается', () => {
    const a = blockFingerprint({ title: '', content: { md: 'первый текст' } })
    const b = blockFingerprint({ title: '', content: { md: 'второй текст' } })
    expect(a).not.toBe(b)
  })

  it('отпечаток короткий и без пробелов — он уезжает в колонку и в проп', () => {
    const fp = blockFingerprint(base)
    expect(fp.length).toBeLessThanOrEqual(64)
    expect(fp).toMatch(/^[a-z0-9]+$/)
  })

  it('пустой вход не падает', () => {
    expect(typeof blockFingerprint({})).toBe('string')
  })
})

/**
 * Отпечаток считается с ЛОКАЛИЗОВАННОГО текста, поэтому сравнивать его можно
 * только с отметкой того же языка. Иначе переключение ru↔en гасило бы все
 * отметки разом — ревьюер при этом ничего не менял.
 */
describe('isStaleMark', () => {
  it('нет отметки — не устарела', () => {
    expect(isStaleMark(undefined, 'abc', 'ru')).toBe(false)
  })

  it('тот же язык, тот же отпечаток — свежая', () => {
    expect(isStaleMark({ fp: 'abc', lang: 'ru' }, 'abc', 'ru')).toBe(false)
  })

  it('тот же язык, другой отпечаток — устарела', () => {
    expect(isStaleMark({ fp: 'abc', lang: 'ru' }, 'xyz', 'ru')).toBe(true)
  })

  it('ДРУГОЙ язык — не судим, даже если отпечатки разные', () => {
    expect(isStaleMark({ fp: 'abc', lang: 'en' }, 'xyz', 'ru')).toBe(false)
  })

  it('язык отметки неизвестен (старые записи) — не судим', () => {
    expect(isStaleMark({ fp: 'abc', lang: '' }, 'xyz', 'ru')).toBe(false)
  })
})
