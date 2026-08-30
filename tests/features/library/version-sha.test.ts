import { describe, expect, it } from 'vitest'
import { toMarkdown, type ExportList } from '@/features/library/export'

/**
 * ПОДПИСЬ ВЕРСИИ (SHA): ПУСТО — ЭТО «—», А НЕ «НЕТ ВЕРСИИ».
 *
 * Версия есть всегда — может не быть её ПОДПИСИ: у списков, созданных до git-слоя,
 * репозитория нет вовсе (58 таких на 30.08). Написать «нет версии» значило бы объявить
 * отсутствующим то, что существует, — та же ошибка, на которой мы уже обожглись с
 * `new_version = 0`, где ноль означал «проекция не легла», а читался как «версии нет».
 *
 * ⚠️ В ИНТЕРФЕЙСЕ И В ФАЙЛЕ ПРАВИЛА РАЗНЫЕ, и это не непоследовательность. Человеку «—»
 * показывает, что графа есть и она пуста. Машине «SHA: —» прочиталось бы как ДАННЫЕ —
 * подпись со значением «—»; отсутствие строки читается однозначно.
 */
const base: ExportList = {
  title: { en: 'Deploy' },
  desc: { en: '' },
  tags: [],
  ordered: true,
  version: 3,
  ownerHandle: 'acme',
  slug: 'deploy',
  steps: [],
}

const head = (md: string) => md.split('\n').find((l) => l.startsWith('>')) ?? ''

describe('подпись версии в экспорте', () => {
  it('есть подпись — она в шапке', () => {
    const md = toMarkdown({ ...base, commitSha: 'a1b2c3d4e5f6' }, 'en')
    expect(head(md)).toBe('> acme/deploy · v3 · `a1b2c3d4e5f6`')
  })

  it('подписи нет — строки о ней НЕТ ВОВСЕ, а не «—»', () => {
    const md = toMarkdown({ ...base, commitSha: null }, 'en')
    expect(head(md)).toBe('> acme/deploy · v3')
    expect(md).not.toContain('—')
    // И уж точно не «нет версии»: версия есть, это видно в той же строке.
    expect(md).toContain('v3')
  })

  it('поле не задано вовсе — ведёт себя как отсутствие подписи', () => {
    // Экспорт обязан работать, когда ядро молчит: файл без подписи честнее отказа.
    expect(head(toMarkdown(base, 'en'))).toBe('> acme/deploy · v3')
  })
})
