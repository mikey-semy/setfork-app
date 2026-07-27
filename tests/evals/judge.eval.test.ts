import { describe, expect, it } from 'vitest'
import { GOLDEN, DUP_PAIRS } from './fixtures'
import { featuresOf, gradeList } from '@/shared/ai/list-grade'
import { findNearDuplicate } from '@/shared/ai/near-duplicate'
import { countDuplicateSteps, structuralBlockers, DEFAULT_BAR } from '@/shared/ai/readiness'

/**
 * EVALS СУДЯЩЕЙ МАШИНЕРИИ — гейт против дрейфа правил, а не против дрейфа модели.
 *
 * «Агенты без evals — это персоны, а не агенты» (AGENTS.md). Полноценные evals генерации
 * требуют вызовов модели: денег, сети и живой БД, — в CI им не место. Зато в CI прекрасно
 * помещается то, что РЕШАЕТ судьбу контента: класс полноты, структурные блокеры планки и
 * детектор почти-дублей. Их дрейф опаснее дрейфа генерации — плохой черновик увидит человек,
 * а сломавшийся судья пропустит в паблик всё подряд.
 *
 * Правило набора: фикстура — это утверждение «вот такое мы считаем годным». Меняешь пороги —
 * меняешь и ожидания ОСОЗНАННО, а не подгоняешь тест под новое поведение.
 *
 * Чего этот гейт НЕ проверяет (и не притворяется): качество текста, правдивость фактов,
 * реальную многогранность совета. Для них есть офлайн-замеры (scripts/council-eval.ts,
 * scripts/facet-eval.ts) — они ходят в БД и запускаются руками.
 */

/** Слова для имён тестов — через словарь, а не тернарником: правило проекта одно на всё. */
const VERDICT_WORD: Record<string, string> = { true: 'проходит планку', false: 'не проходит планку' }
const DUP_WORD: Record<string, string> = { true: 'дубль', false: 'разные списки' }

describe('evals: класс полноты на золотом наборе', () => {
  for (const c of GOLDEN) {
    it(`${c.name} → ${c.expect.grade}`, () => {
      const verdict = gradeList(featuresOf(c.items, c.deadLinks ?? 0))
      expect(verdict.grade, `${c.name}: ${verdict.next.join('; ')}`).toBe(c.expect.grade)
    })
  }

  it('у каждого не-full случая есть ВНЯТНАЯ причина, чего не хватило', () => {
    for (const c of GOLDEN.filter((x) => x.expect.grade !== 'full')) {
      const v = gradeList(featuresOf(c.items, c.deadLinks ?? 0))
      expect(v.next.length, `${c.name}: класс ниже full, но next пуст`).toBeGreaterThan(0)
    }
  })
})

describe('evals: структурная часть планки', () => {
  for (const c of GOLDEN) {
    it(`${c.name} → ${VERDICT_WORD[String(c.expect.passesDefaultBar)]}`, () => {
      const f = featuresOf(c.items, c.deadLinks ?? 0)
      const v = gradeList(f)
      const blockers = structuralBlockers(
        {
          steps: c.items.length,
          deadLinks: c.deadLinks ?? 0,
          hasDesc: true,
          hasTags: c.tags.length > 0,
          duplicateSteps: countDuplicateSteps(c.items.map((i) => i.title)),
          grade: v.grade,
          gradeNext: v.next,
        },
        DEFAULT_BAR,
      )
      expect(blockers.length === 0, `${c.name}: ${blockers.join('; ')}`).toBe(c.expect.passesDefaultBar)
    })
  }

  it('набивка объёма не проходит планку, даже когда класс высокий', () => {
    const padded = GOLDEN.find((c) => c.name.startsWith('набивка'))!
    const f = featuresOf(padded.items)
    expect(gradeList(f).grade).toBe('full') // структурно всё «на месте»…
    const blockers = structuralBlockers(
      { steps: padded.items.length, deadLinks: 0, hasDesc: true, hasTags: true, duplicateSteps: countDuplicateSteps(padded.items.map((i) => i.title)), grade: 'full', gradeNext: [] },
      DEFAULT_BAR,
    )
    expect(blockers.join(' ')).toContain('повторяющихся шагов') // …но дубли ловятся отдельно
  })
})

describe('evals: почти-дубли', () => {
  for (const p of DUP_PAIRS) {
    it(`${p.name} → ${DUP_WORD[String(p.duplicate)]}`, () => {
      const v = findNearDuplicate(p.b, [{ id: 'a', ...p.a }])
      expect(!!v.match, `${p.name}: сходство ${v.best}`).toBe(p.duplicate)
    })
  }

  it('порог не «на волосок»: у дублей запас, у разных — тоже', () => {
    for (const p of DUP_PAIRS) {
      const v = findNearDuplicate(p.b, [{ id: 'a', ...p.a }])
      // Запас 0.05 в обе стороны: иначе любая правка стеммера переворачивает вердикт.
      if (p.duplicate) expect(v.best, p.name).toBeGreaterThan(0.35)
      else expect(v.best, p.name).toBeLessThan(0.25)
    }
  })
})
