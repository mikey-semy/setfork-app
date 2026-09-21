import { describe, expect, it } from 'vitest'
import { saveOutcomeQuery } from '@/features/library/save-outcome'

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
})
