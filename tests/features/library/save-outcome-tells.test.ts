import { describe, expect, it } from 'vitest'
import { draftRefField, parseDraftRef, publishHeldQuery, saveOutcomeQuery, shouldHoldPublish } from '@/features/library/save-outcome'

/**
 * СОХРАНЕНИЕ ГОВОРИТ, ЧТО СЛУЧИЛОСЬ.
 *
 * Запись черновика из редактора проходит всегда — отказ в серверной форме уходит
 * редиректом и уносит набранное. Значит единственное, чем случаи отличаются, — что
 * человек узнаёт. Раньше он не узнавал ничего в двух положениях сразу:
 *
 *   • его состав лёг ПОВЕРХ правок, пришедших в тот же черновик через агента;
 *   • в шаге есть команда, которую публикация не пропустит — отказ приходил позже и
 *     другому человеку, владельцу, по шагу, которого он не писал.
 *
 * Тест на КЛАСС: перечень положений и то, что обязано быть сказано в каждом.
 */
describe('после сохранения человеку сказано, что произошло', () => {
  it('обычное сохранение — только подтверждение', () => {
    expect(saveOutcomeQuery({ overwrote: false, destructiveStep: null })).toBe('saved=1')
  })

  it('легло поверх правок агента — сказано об этом', () => {
    const q = saveOutcomeQuery({ overwrote: true, destructiveStep: null })
    expect(q, 'затирание снова тихое').toContain('over=1')
    expect(q, 'сохранение обязано подтвердиться: оно состоялось').toContain('saved=1')
  })

  it('запрещённая команда — назван НОМЕР шага, а не просто факт', () => {
    const q = saveOutcomeQuery({ overwrote: false, destructiveStep: 3 })
    expect(q).toContain('warn=destructive')
    // Без номера человеку придётся искать шаг самому — в длинном списке это и значит
    // «сообщение есть, пользы нет».
    expect(q, 'номер шага потерян').toContain('step=3')
  })

  it('опасное в ФАЙЛЕ — назван путь, а не «шаг 0»', () => {
    const d = saveOutcomeQuery({ overwrote: false, destructiveStep: null, file: { kind: 'destructive', path: 'scripts/clean.py' } })
    expect(d).toContain('warn=destructive')
    expect(d, 'файл не назван').toContain('file=scripts%2Fclean.py')
    const k = saveOutcomeQuery({ overwrote: false, destructiveStep: null, file: { kind: 'secret', path: 'references/a b.md', rule: 'github-pat' } })
    expect(k).toContain('warn=secret')
    expect(k).toContain('kind=github-pat')
    expect(k, 'путь с пробелом обязан пережить адрес').toContain('file=references%2Fa%20b.md')
  })

  it('шаг важнее файла: одно предупреждение за раз, и начинается с шагов', () => {
    const q = saveOutcomeQuery({ overwrote: false, destructiveStep: 2, file: { kind: 'destructive', path: 'scripts/x.sh' } })
    expect(q).toContain('step=2')
    expect(q).not.toContain('file=')
  })

  it('оба положения разом — сказано про оба', () => {
    const q = saveOutcomeQuery({ overwrote: true, destructiveStep: 7 })
    expect(q).toContain('over=1')
    expect(q).toContain('warn=destructive')
    expect(q).toContain('step=7')
  })

  it('первый шаг — не путается с «нет шага»', () => {
    // Номер приходит как 0 только если считать с нуля; здесь счёт с единицы, и шаг 1
    // обязан назваться, а не исчезнуть из-за ложной проверки на пустоту.
    expect(saveOutcomeQuery({ overwrote: false, destructiveStep: 1 })).toContain('step=1')
  })

  it('ключ доступа — назван вид ключа и шаг, и он важнее команды', () => {
    const q = saveOutcomeQuery({ overwrote: false, destructiveStep: 2, secret: { step: 5, rule: 'github-pat' } })
    expect(q).toContain('warn=secret')
    expect(q).toContain('step=5')
    expect(q).toContain('kind=github-pat')
    // Предупреждение одно: два `step=` в адресе странице не разобрать.
    expect(q).not.toContain('warn=destructive')
  })

  it('ключ в названии (шаг 0) — не путается с «ключа нет»', () => {
    expect(saveOutcomeQuery({ overwrote: false, destructiveStep: null, secret: { step: 0, rule: 'aws-access-token' } })).toContain('warn=secret')
  })
})

/**
 * СИГНАЛ ДОХОДИТ ДО РЕШЕНИЯ.
 *
 * Оба P1 авто-ревью по #945 — один корень: признак затирания вырабатывался и терялся.
 * Один раз по дороге ОТ формы (пустое поле ревизии отключало сверку целиком), другой —
 * ПОСЛЕ записи (публикация выбрасывала исход и шла дальше). Сторож срабатывал, дверь
 * открывалась.
 */
describe('признак затирания доходит до решения', () => {
  it('черновика нет — поле несёт явное «none», а не пустоту', () => {
    // Пустая строка доезжает до записи как `undefined` = «сравнивать не с чем», и
    // сверка отключается вовсе. `none` говорит «черновика не было» и сравнению не мешает.
    expect(draftRefField(3, null), 'сверка отключится, и правки агента сотрутся молча').toBe('3@none')
    expect(draftRefField(3, undefined)).toBe('3@none')
  })

  // ⚠️ ABA: номер нового черновика всегда 1, поэтому опознавать объект одним числом
  // нельзя — строку могли заменить на другую с тем же номером.
  it('черновик есть — поле несёт СТРОКУ и номер, а не один номер', () => {
    const field = draftRefField(3, { id: 'd-1', rev: 7 })
    expect(field, 'опознаётся возраст, а не объект').toContain('d-1')
    expect(field).toContain('7')
  })

  it('разбор возвращает то же самое', () => {
    expect(parseDraftRef(draftRefField(3, { id: 'd-1', rev: 7 }))).toEqual({
      listVersion: 3,
      draft: { id: 'd-1', rev: 7 },
    })
    expect(parseDraftRef(draftRefField(3, null))).toEqual({ listVersion: 3, draft: 'none' })
  })

  // ⚠️ Версия списка в признаке — не украшение: «черновика не было при версии 3» и
  // «черновика нет при версии 4» это РАЗНЫЕ состояния, и второе означает, что между
  // ними что-то опубликовали (третий P1 авто-ревью по #945).
  it('поле несёт ВЕРСИЮ СПИСКА, а не только состояние черновика', () => {
    expect(draftRefField(3, null), 'событие со списком станет неотличимо').not.toBe(draftRefField(4, null))
  })

  it('неразбираемое поле — как «поля не прислали», а не как совпадение', () => {
    // Выдумать здесь опаснее, чем промолчать: ложное «совпало» отключает удержание.
    expect(parseDraftRef(''), 'пустое поле прочиталось как осмысленное').toBeUndefined()
    expect(parseDraftRef(null)).toBeUndefined()
    expect(parseDraftRef('мусор')).toBeUndefined()
    expect(parseDraftRef('none'), 'без версии списка признак неполон').toBeUndefined()
    // ⚠️ Эту порчу стенд поймал ВЫЖИВШЕЙ: версия есть, а состояние черновика — мусор.
    // Прочитать его как «черновика не было» значит выдумать совпадение и отключить
    // удержание ровно там, где о состоянии ничего не известно.
    expect(parseDraftRef('3@abc'), 'мусор после версии выдан за «черновика не было»').toBeUndefined()
    expect(parseDraftRef('x@d-1:2'), 'нечисловая версия прочитана как осмысленная').toBeUndefined()
  })

  it('затирание обнаружено — публикация останавливается', () => {
    expect(shouldHoldPublish({ overwrote: true }), 'правки агента уедут в коммит молча').toBe(true)
  })

  // ⚠️ Обратная сторона: останавливать всегда — значит сделать кнопку публикации
  // неработающей и приучить жать её дважды.
  it('затирания не было — публикация идёт', () => {
    expect(shouldHoldPublish({ overwrote: false })).toBe(false)
  })

  it('остановка сообщает и о сохранении, и о причине', () => {
    const q = publishHeldQuery()
    expect(q, 'человек решит, что потерял набранное').toContain('saved=1')
    expect(q, 'причина остановки не названа').toContain('over=1')
    expect(q, 'не видно, что версия НЕ вышла').toContain('held=1')
  })
})
