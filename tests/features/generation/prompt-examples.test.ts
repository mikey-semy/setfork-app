import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { promptExamples } from '@/features/generation/prompt-examples'

/**
 * ⚠️ ГЕНЕРАЦИЯ НЕ ПРЕДЛАГАЕТ СОЗДАТЬ ТО, ЧТО УЖЕ ЕСТЬ.
 *
 * Под полем стояли заголовки существующих публичных списков — человек видел
 * предложение «создать» собственный же список (замечание владельца 02.09.2026:
 * «предложка глупо предлагает то, что уже есть — смысл?»). Задумка «как подсказки
 * поисковика» была неверной аналогией: поисковик подсказывает ЗАПРОС, а не готовую
 * страницу с предложением создать её заново.
 */
const page = readFileSync(new URL('../../../src/app/generate/page.tsx', import.meta.url).pathname, 'utf8')

describe('примеры на старте генерации', () => {
  it('страница не берёт заголовки существующих списков', () => {
    expect(page, 'живые заголовки принадлежат витрине, а не форме создания').not.toMatch(/sampleListTitles/)
    expect(page).toMatch(/promptExamples/)
  })

  it('примеры непустые и разные на обоих языках', () => {
    for (const lang of ['ru', 'en'] as const) {
      const ex = promptExamples(lang)
      expect(ex.length).toBeGreaterThanOrEqual(4)
      expect(new Set(ex).size, `${lang}: примеры повторяются`).toBe(ex.length)
      for (const e of ex) expect(e.length, `${lang}: пустой пример`).toBeGreaterThan(10)
    }
  })

  it('перевод не потерян: русский и английский наборы различаются', () => {
    // Пропущенный ключ в словаре вернул бы одну и ту же строку на обоих языках.
    expect(promptExamples('ru')).not.toEqual(promptExamples('en'))
  })
})
